import { useState, useEffect, useRef } from 'react';
import { useSession } from '../context/session-context';
import type { SessionProfile } from '../types/session';
import { parseServerTimestamp } from '../utils/time';
import { fetchProfiles, type ProfileOption } from '../services/profilesApi';


const PROFILE_DOT_CLASS = 'bg-indigo-400';

export function Sidebar() {
  const {
    sessions,
    currentSession,
    statuses,
    isLoading,
    createSession,
    selectSession,
    deleteSession,
    updateSessionTitle,
  } = useSession();

  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);
  useEffect(() => {
    fetchProfiles()
      .then(({ profiles }) => setProfileOptions(profiles))
      .catch((error) => console.error('Failed to load profiles:', error));
  }, []);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (e: React.MouseEvent, session: { id: string; title: string }) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditValue(session.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue('');
  };

  const commitRename = async () => {
    if (!editingId) return;
    const trimmed = editValue.trim();
    const original = sessions.find((s) => s.id === editingId)?.title ?? '';
    setEditingId(null);
    setEditValue('');
    if (!trimmed || trimmed === original) return;
    try {
      await updateSessionTitle(editingId, trimmed);
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  const handleSelectProfile = async (profile: SessionProfile) => {
    setMenuOpen(false);
    await createSession(undefined, profile);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this session?')) {
      await deleteSession(id);
    }
  };

  return (
    <div className="w-64 bg-slate-900 border-r border-slate-700 flex flex-col h-full">
      <div className="p-4 border-b border-slate-700 relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Session
          <svg
            className={`w-4 h-4 ml-1 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute left-4 right-4 mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10 overflow-hidden">
            {profileOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => handleSelectProfile(option.id)}
                className="w-full px-4 py-3 text-left hover:bg-slate-700 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${PROFILE_DOT_CLASS}`}
                  />
                  <div className="text-slate-100 text-sm font-medium">
                    {option.displayName}
                  </div>
                </div>
                {option.description && (
                  <div className="text-slate-400 text-xs mt-1">
                    {option.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-slate-400 text-sm">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-slate-400 text-sm">
            No sessions yet. Create one to get started.
          </div>
        ) : (
          <ul className="py-2">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  onClick={() => selectSession(session.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-slate-800 transition-colors group ${
                    currentSession?.id === session.id
                      ? 'bg-slate-800 border-l-2 border-blue-500'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span
                        aria-hidden="true"
                        title={session.profile}
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${PROFILE_DOT_CLASS}`}
                      />
                      {editingId === session.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={() => {
                            void commitRename();
                          }}
                          className="flex-1 min-w-0 bg-slate-900 border border-slate-600 text-slate-100 text-sm rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        />
                      ) : (
                        <span className="text-slate-200 text-sm truncate">
                          {session.title}
                        </span>
                      )}
                    </div>
                    {editingId !== session.id && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) =>
                            startRename(e, { id: session.id, title: session.title })
                          }
                          className="p-1 hover:bg-slate-700 rounded"
                          title="Rename session"
                        >
                          <svg
                            className="w-4 h-4 text-slate-400 hover:text-blue-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session.id)}
                          className="p-1 hover:bg-slate-700 rounded"
                          title="Delete session"
                        >
                          <svg
                            className="w-4 h-4 text-slate-400 hover:text-red-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-slate-500 text-xs">
                      {parseServerTimestamp(session.updated_at).toLocaleDateString()}
                    </span>
                    {(() => {
                      const status = statuses[session.id];
                      if (status?.processing) {
                        return (
                          <span
                            aria-label="Processing"
                            title="Generating a response…"
                            className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"
                          />
                        );
                      }
                      if (status?.hasError) {
                        return (
                          <span
                            aria-label="Turn failed"
                            title="Last turn failed — no response"
                            className="w-2 h-2 rounded-full bg-rose-500"
                          />
                        );
                      }
                      if (status?.hasUnread) {
                        return (
                          <span
                            aria-label="New response"
                            title="New response ready"
                            className="w-2 h-2 rounded-full bg-emerald-400"
                          />
                        );
                      }
                      return null;
                    })()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-slate-700 text-slate-500 text-xs">
        Local · Pi, OMP, or Claude CLI
      </div>
    </div>
  );
}
