import React from 'react';

export interface GeminiPpeNarrativeProps {
  missingHardhats?: number;
  missingVests?: number;
  /** Smaller typography for camera grid / compact panels */
  compact?: boolean;
  className?: string;
}

/**
 * Qualitative PPE copy from Gemini fields — mentions violations without numeric counts.
 */
const GeminiPpeNarrative: React.FC<GeminiPpeNarrativeProps> = ({
  missingHardhats: mh,
  missingVests: mv,
  compact = false,
  className,
}) => {
  if (mh === undefined && mv === undefined) return null;

  const lines: string[] = [];

  if (mh !== undefined && mh > 0) {
    lines.push(
      'PPE concern: people were detected missing hardhats or not wearing required head protection.'
    );
  }
  if (mv !== undefined && mv > 0) {
    lines.push(
      'PPE concern: people were detected missing safety vests or not wearing required high-visibility vests.'
    );
  }

  if (lines.length === 0) return null;

  const fontSize = compact ? '0.8rem' : '1rem';

  return (
    <div
      className={className}
      style={{
        marginBottom: compact ? '0.5rem' : '2rem',
        padding: compact ? '0.25rem 0' : '1rem 0',
      }}
    >
      <h3
        style={{
          color: compact ? '#e1bee7' : '#bb86fc',
          fontSize: compact ? '0.85rem' : '1.3rem',
          marginBottom: compact ? '0.5rem' : '0.75rem',
          marginTop: 0,
        }}
      >
        🦺 PPE observations
      </h3>
      <div
        style={{
          color: 'rgba(255,255,255,0.92)',
          fontSize,
          lineHeight: 1.6,
        }}
      >
        {lines.map((text, i) => (
          <p
            key={i}
            style={{
              margin: 0,
              marginBottom: i < lines.length - 1 ? '0.5rem' : 0,
            }}
          >
            {text}
          </p>
        ))}
      </div>
    </div>
  );
};

export default GeminiPpeNarrative;
