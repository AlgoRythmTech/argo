// argo:upstream 21st.dev@ai-loader
// The fullscreen loader Argo shows while a build is in flight.
import * as React from 'react';

export interface AiLoaderProps {
  size?: number;
  text?: string;
}

export const AiLoader: React.FC<AiLoaderProps> = ({ size = 180, text = 'Generating' }) => {
  const letters = text.split('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-[#001a35] via-[#0a0a0b] to-black">
      <div
        className="relative flex items-center justify-center select-none"
        style={{ width: size, height: size }}
      >
        {letters.map((letter, index) => (
          <span
            key={`loader-letter-${index}`}
            className="inline-block text-argo-text opacity-50 argo-loader-letter"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            {letter}
          </span>
        ))}
        <div className="absolute inset-0 rounded-full argo-loader-circle" />
      </div>
      <style>{`
        @keyframes argoLoaderCircle {
          0%   { transform: rotate(90deg);  box-shadow: 0 6px 12px 0 #00e5cc inset, 0 12px 18px 0 #0091ff inset, 0 36px 36px 0 #1e40af inset, 0 0 3px 1.2px rgba(0, 229, 204, 0.3), 0 0 6px 1.8px rgba(0, 145, 255, 0.2); }
          50%  { transform: rotate(270deg); box-shadow: 0 6px 12px 0 #60a5fa inset, 0 12px 6px 0 #0284c7 inset, 0 24px 36px 0 #00e5cc inset, 0 0 3px 1.2px rgba(0, 229, 204, 0.3), 0 0 6px 1.8px rgba(0, 145, 255, 0.2); }
          100% { transform: rotate(450deg); box-shadow: 0 6px 12px 0 #4dc8fd inset, 0 12px 18px 0 #00e5cc inset, 0 36px 36px 0 #1e40af inset, 0 0 3px 1.2px rgba(0, 229, 204, 0.3), 0 0 6px 1.8px rgba(0, 145, 255, 0.2); }
        }
        @keyframes argoLoaderLetter {
          0%, 100% { opacity: 0.4; transform: translateY(0); }
          20%      { opacity: 1;    transform: scale(1.15); }
          40%      { opacity: 0.7;  transform: translateY(0); }
        }
        .argo-loader-circle { animation: argoLoaderCircle 5s linear infinite; }
        .argo-loader-letter { animation: argoLoaderLetter 3s infinite; }
      `}</style>
    </div>
  );
};
