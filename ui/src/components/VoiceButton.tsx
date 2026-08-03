interface VoiceButtonProps {
  isRecording: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  processingStage?: 'whisper' | 'agent' | 'piper';
  onClick: () => void;
  onStop?: () => void;
  disabled?: boolean;
}

const STAGE_LABELS: Record<NonNullable<VoiceButtonProps['processingStage']>, string> = {
  whisper: 'Transcribing…',
  agent: 'Thinking…',
  piper: 'Synthesizing…',
};

export function VoiceButton({
  isRecording,
  isProcessing,
  isPlaying,
  processingStage,
  onClick,
  onStop,
  disabled,
}: VoiceButtonProps) {
  const getButtonState = () => {
    if (isPlaying) return 'playing';
    if (isProcessing) return 'processing';
    if (isRecording) return 'recording';
    return 'idle';
  };

  const state = getButtonState();

  const stateStyles = {
    idle: 'bg-indigo-600 hover:bg-indigo-700 hover:scale-105',
    recording: 'bg-red-500 hover:bg-red-600 animate-pulse',
    processing: 'bg-amber-500 cursor-wait',
    playing: 'bg-green-500 hover:bg-green-600 hover:scale-105',
  };

  const stateIcons = {
    idle: (
      <svg
        className="w-12 h-12"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
        />
      </svg>
    ),
    recording: (
      <svg
        className="w-12 h-12"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    ),
    processing: (
      <svg
        className="w-12 h-12 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    ),
    playing: (
      <svg
        className="w-12 h-12"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M6 6h4v12H6zm8 0h4v12h-4z" />
      </svg>
    ),
  };

  const stateLabels = {
    idle: 'Click to speak',
    recording: 'Click to stop',
    processing: processingStage ? STAGE_LABELS[processingStage] : 'Processing…',
    playing: 'Click to stop',
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={isPlaying && onStop ? onStop : onClick}
        disabled={disabled || isProcessing}
        className={`
          w-24 h-24 rounded-full flex items-center justify-center
          text-white shadow-lg transition-all duration-200
          focus:outline-none focus:ring-4 focus:ring-indigo-300
          disabled:opacity-50 disabled:cursor-not-allowed
          ${stateStyles[state]}
        `}
      >
        {stateIcons[state]}
      </button>
      <span className="text-gray-600 text-sm font-medium">
        {stateLabels[state]}
      </span>
    </div>
  );
}
