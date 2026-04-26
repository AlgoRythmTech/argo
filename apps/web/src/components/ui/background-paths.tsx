// argo:upstream 21st.dev@background-paths
// Animated SVG paths for the marketing landing background.
import { motion } from 'framer-motion';
import { Button } from './button.js';

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${
      189 + i * 6
    } -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${
      343 - i * 6
    }C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg className="w-full h-full text-argo-accent/40" viewBox="0 0 696 316" fill="none">
        <title>Background Paths</title>
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.1 + path.id * 0.03}
            initial={{ pathLength: 0.3, opacity: 0.6 }}
            animate={{ pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] }}
            transition={{
              duration: 20 + Math.random() * 10,
              repeat: Number.POSITIVE_INFINITY,
              ease: 'linear',
            }}
          />
        ))}
      </svg>
    </div>
  );
}

export interface BackgroundPathsProps {
  title?: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  subtitle?: string;
}

export function BackgroundPaths({
  title = 'Argo',
  ctaLabel = 'Start operating',
  onCtaClick,
  subtitle = 'Describe the workflow once. Argo runs it. Reply to email when it asks.',
}: BackgroundPathsProps) {
  const words = title.split(' ');
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-argo-bg">
      <div className="absolute inset-0">
        <FloatingPaths position={1} />
        <FloatingPaths position={-1} />
      </div>
      <div className="relative z-10 container mx-auto px-4 md:px-6 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.4 }}
          className="max-w-4xl mx-auto"
        >
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-bold mb-8 tracking-tighter">
            {words.map((word, wordIndex) => (
              <span key={wordIndex} className="inline-block mr-4 last:mr-0">
                {word.split('').map((letter, letterIndex) => (
                  <motion.span
                    key={`${wordIndex}-${letterIndex}`}
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{
                      delay: wordIndex * 0.1 + letterIndex * 0.03,
                      type: 'spring',
                      stiffness: 150,
                      damping: 25,
                    }}
                    className="inline-block text-transparent bg-clip-text bg-gradient-to-r from-argo-text to-argo-text/70"
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>
            ))}
          </h1>
          <p className="text-argo-textSecondary text-lg md:text-xl mb-12 max-w-2xl mx-auto">
            {subtitle}
          </p>
          <div className="inline-block group relative bg-gradient-to-b from-argo-accent/30 to-argo-accent/0 p-px rounded-2xl backdrop-blur-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
            <Button
              variant="ghost"
              onClick={onCtaClick}
              className="rounded-[1.15rem] px-8 py-6 text-lg font-semibold backdrop-blur-md bg-argo-bg/95 hover:bg-argo-bg text-argo-text transition-all duration-300 group-hover:-translate-y-0.5 border border-argo-accent/30"
            >
              <span className="opacity-90 group-hover:opacity-100 transition-opacity">{ctaLabel}</span>
              <span className="ml-3 opacity-70 group-hover:opacity-100 group-hover:translate-x-1.5 transition-all duration-300">
                →
              </span>
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
