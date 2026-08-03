import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSession } from '../context/session-context';
import type { Message } from '../types/session';
import { audioUrlForMessage, fetchAudioBlob, playAudioBlob } from '../services/api';
import { parseServerTimestamp } from '../utils/time';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'expired' | 'error';

function PlayButton({ messageId }: { messageId: number }) {
  const [state, setState] = useState<PlaybackState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleClick = async () => {
    if (state === 'playing') {
      audioRef.current?.pause();
      audioRef.current = null;
      setState('idle');
      return;
    }
    if (state === 'loading') return;

    setState('loading');
    try {
      const blob = await fetchAudioBlob(audioUrlForMessage(messageId));
      const { audio, promise } = playAudioBlob(blob);
      audioRef.current = audio;
      setState('playing');
      await promise;
      audioRef.current = null;
      setState('idle');
    } catch (err) {
      audioRef.current = null;
      if (err instanceof Error && err.message === 'expired') {
        setState('expired');
      } else {
        console.warn('Playback error:', err);
        setState('error');
      }
    }
  };

  if (state === 'expired') {
    return (
      <span
        className="text-xs text-slate-500 italic"
        title="Audio no longer available (older than 24h)"
      >
        audio expired
      </span>
    );
  }

  const label =
    state === 'playing' ? 'Stop' : state === 'loading' ? 'Loading…' : 'Play';
  const icon =
    state === 'playing' ? (
      <svg
        className="w-3 h-3"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    ) : state === 'loading' ? (
      <svg
        className="w-3 h-3 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-25"
        />
        <path
          d="M3 12a9 9 0 019-9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ) : (
      <svg
        className="w-3 h-3"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    );

  return (
    <button
      type="button"
      onClick={handleClick}
      title={state === 'error' ? 'Playback failed — click to retry' : label}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded hover:bg-slate-600 transition-colors ${
        state === 'error' ? 'text-red-300' : 'text-slate-300'
      }`}
    >
      {icon}
      <span>{state === 'error' ? 'retry' : label.toLowerCase()}</span>
    </button>
  );
}

function ErrorNote({ message }: { message: Message }) {
  return (
    <div className="flex justify-center mb-4">
      <div className="max-w-[85%] px-3 py-2 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs text-center">
        <span className="whitespace-pre-wrap">{message.content}</span>
        <div className="text-rose-400/70 mt-1">
          {parseServerTimestamp(message.created_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-slate-700 text-slate-100 rounded-bl-md'
        }`}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        ) : (
          <div className="text-sm leading-relaxed markdown-body overflow-x-auto">
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          </div>
        )}
        <div
          className={`flex items-center justify-between gap-2 mt-1 ${
            isUser ? 'text-blue-200' : 'text-slate-400'
          }`}
        >
          <span className="text-xs">
            {parseServerTimestamp(message.created_at).toLocaleTimeString()}
          </span>
          {!isUser && <PlayButton messageId={message.id} />}
        </div>
      </div>
    </div>
  );
}

export function Conversation() {
  const { currentSession } = useSession();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p>Select a session or create a new one to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {currentSession.messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-slate-400">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-slate-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <p>Press the button below to start talking</p>
          </div>
        </div>
      ) : (
        <>
          {currentSession.messages.map((message) =>
            message.is_error ? (
              <ErrorNote key={message.id} message={message} />
            ) : (
              <MessageBubble key={message.id} message={message} />
            ),
          )}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}
