/** Shared TTS speaker / skip / stop icons for the 3D dock and chat chips. */

type ToggleProps = {
  enabled: boolean;
  ready?: boolean;
  compact?: boolean;
  speaking?: boolean;
  titleOn?: string;
  titleOff?: string;
  titleSpeaking?: string;
  onClick: () => void;
};

export function TtsToggleButton({
  enabled,
  ready = true,
  compact,
  speaking = false,
  titleOn = "Disable TTS (auto-speak replies)",
  titleOff = "Enable TTS (auto-speak replies)",
  titleSpeaking,
  onClick,
}: ToggleProps) {
  const title = !ready && !enabled
    ? "TTS needs FISH_API_KEY on oc-controller"
    : speaking
      ? titleSpeaking || titleOn
      : enabled
        ? titleOn
        : titleOff;
  return (
    <button
      type="button"
      className={`scene-voice-btn ${compact ? "compact" : ""} ${enabled ? "on" : "off"} ${speaking ? "speaking" : ""}`}
      title={title}
      aria-pressed={enabled}
      aria-current={speaking ? "true" : undefined}
      disabled={!ready && !enabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {enabled ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M5 9v6h4l5 5V4L9 9H5Zm12.5 3A4.5 4.5 0 0 0 14 8.65v6.7A4.5 4.5 0 0 0 17.5 12ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23Z"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4.27 3 3 4.27 7.73 9H5v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.55-1.77L19.73 21 21 19.73 4.27 3ZM14 4 12.1 5.9 14 7.8V4Z"
          />
        </svg>
      )}
    </button>
  );
}

type SkipStopProps = {
  compact?: boolean;
  disableSkip?: boolean;
  disableStop?: boolean;
  onSkip: () => void;
  onStop: () => void;
};

export function TtsSkipStopButtons({
  compact,
  disableSkip,
  disableStop,
  onSkip,
  onStop,
}: SkipStopProps) {
  return (
    <>
      <button
        type="button"
        className={`scene-voice-btn ${compact ? "compact" : ""}`}
        title="Skip current utterance"
        disabled={disableSkip}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSkip();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 18l8.5-6L6 6v12zm9-12v12h2V6h-2z" />
        </svg>
      </button>
      <button
        type="button"
        className={`scene-voice-btn ${compact ? "compact" : ""}`}
        title="Stop TTS queue"
        disabled={disableStop}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStop();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 6h12v12H6z" />
        </svg>
      </button>
    </>
  );
}
