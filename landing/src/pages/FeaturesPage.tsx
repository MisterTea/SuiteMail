import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Keyboard,
  Play,
  Volume2,
  Captions,
} from 'lucide-react'
import { SiteLayout } from '../components/SiteLayout'
import { withBase } from '../lib/paths'
import {
  STORYBOARDS,
  STORYBOARD_CATEGORIES,
  type StoryboardCategory,
} from '../data/storyboards'

export function FeaturesPage() {
  const [selectedCategory, setSelectedCategory] = useState<'All' | StoryboardCategory>('All')
  const [activeId, setActiveId] = useState<number>(1)
  const [showTranscript, setShowTranscript] = useState<boolean>(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const theaterRef = useRef<HTMLElement | null>(null)

  const filteredStoryboards = useMemo(() => {
    if (selectedCategory === 'All') return STORYBOARDS
    return STORYBOARDS.filter((sb) => sb.category === selectedCategory)
  }, [selectedCategory])

  const activeStoryboard = useMemo(
    () => STORYBOARDS.find((sb) => sb.id === activeId) ?? STORYBOARDS[0],
    [activeId],
  )

  const activeIndex = STORYBOARDS.findIndex((sb) => sb.id === activeStoryboard.id)

  const selectStoryboard = (id: number, autoPlay = false, scrollToTheater = false) => {
    setActiveId(id)
    if (scrollToTheater && theaterRef.current) {
      theaterRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (autoPlay) {
      requestAnimationFrame(() => {
        videoRef.current?.play().catch(() => {
          // Browser autoplay policy may require manual play
        })
      })
    }
  }

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load()
    }
  }, [activeStoryboard.videoFile])

  const goPrev = () => {
    const prev = STORYBOARDS[(activeIndex - 1 + STORYBOARDS.length) % STORYBOARDS.length]
    selectStoryboard(prev.id, true)
  }

  const goNext = () => {
    const next = STORYBOARDS[(activeIndex + 1) % STORYBOARDS.length]
    selectStoryboard(next.id, true)
  }

  return (
    <SiteLayout activePage="features">
      {/* Header */}
      <section className="border-b border-line subtle-grid">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-12 sm:pt-20 sm:pb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pine-soft text-pine-ink text-xs font-semibold tracking-wide mb-5">
            <Film className="w-3.5 h-3.5" />
            20 NARRATED FEATURE STORYBOARDS
          </div>
          <h1 className="font-display text-4xl sm:text-6xl text-ink leading-[1.06] max-w-3xl">
            Every everyday email workflow,{' '}
            <span className="italic text-pine">narrated and demonstrated.</span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            Watch real recordings of SuiteMail in action across all 20 core storyboards—from
            instant local reading and composing to snoozing, calendar RSVPs, one-click
            unsubscribe, phishing protection, and bulk triage.
          </p>
        </div>
      </section>

      {/* Featured Interactive Theater */}
      <section ref={theaterRef} className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 pb-8 scroll-mt-20">
        <div className="rounded-2xl bg-studio text-white p-5 sm:p-8 shadow-xl ring-1 ring-ink/10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Mobile-frame Video Player */}
            <div className="lg:col-span-5 flex justify-center">
              <div className="w-full max-w-[300px] sm:max-w-[320px] rounded-[28px] bg-black p-2.5 ring-1 ring-white/15 shadow-2xl">
                <div className="rounded-[20px] overflow-hidden bg-black aspect-[390/844]">
                  <video
                    ref={videoRef}
                    controls
                    playsInline
                    preload="metadata"
                    poster={withBase(
                      `videos/storyboards/posters/${activeStoryboard.videoFile.replace(/\.mp4$/, '.jpg')}`,
                    )}
                    className="w-full h-full object-contain bg-black"
                    src={withBase(`videos/storyboards/${activeStoryboard.videoFile}`)}
                  >
                    Your browser does not support HTML5 video playback.
                  </video>
                </div>
              </div>
            </div>

            {/* Active Storyboard Details & Controls */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-emerald-300 mb-3">
                  <span className="px-2.5 py-1 rounded-full bg-white/10">
                    STORYBOARD {String(activeStoryboard.id).padStart(2, '0')} / 20
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-200">
                    {activeStoryboard.category}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-white/70">
                    <Volume2 className="w-3.5 h-3.5" />
                    Narrated
                  </span>
                </div>

                <h2 className="font-display text-3xl sm:text-4xl text-white">
                  {activeStoryboard.title}
                </h2>
                <p className="mt-3 text-base text-white/80 leading-relaxed">
                  {activeStoryboard.summary}
                </p>

                {activeStoryboard.shortcutHint && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-xs font-mono text-white/85">
                    <Keyboard className="w-3.5 h-3.5 text-emerald-300" />
                    Desktop shortcut: {activeStoryboard.shortcutHint}
                  </div>
                )}
              </div>

              {/* Narration Transcript */}
              <div className="rounded-xl bg-studio-card border border-white/10 p-4">
                <button
                  type="button"
                  onClick={() => setShowTranscript((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-mono uppercase tracking-wider text-white/65 hover:text-white transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <Captions className="w-4 h-4 text-emerald-300" />
                    Narration Transcript
                  </span>
                  <span>{showTranscript ? 'Hide' : 'Show'}</span>
                </button>
                {showTranscript && (
                  <p className="mt-3 text-sm text-white/85 leading-relaxed">
                    “{activeStoryboard.narration}”
                  </p>
                )}
              </div>

              {/* Prev / Next Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={goPrev}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium text-white transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous Storyboard
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pine hover:bg-pine-dark text-sm font-semibold text-white transition-colors"
                >
                  Next Storyboard
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Category Filter + Full 20-Storyboard Gallery */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <h2 className="font-display text-2xl sm:text-3xl text-ink">
            All Storyboards ({filteredStoryboards.length})
          </h2>

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter storyboards by category">
            {STORYBOARD_CATEGORIES.map((category) => {
              const isSelected = category === selectedCategory
              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-pine text-white'
                      : 'bg-surface border border-line text-ink-muted hover:border-pine hover:text-pine'
                  }`}
                >
                  {category}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {filteredStoryboards.map((sb) => {
            const isActive = sb.id === activeStoryboard.id
            return (
              <article
                key={sb.id}
                className={`rounded-2xl border bg-surface overflow-hidden flex flex-col transition-all ${
                  isActive
                    ? 'border-pine ring-2 ring-pine/20 shadow-md'
                    : 'border-line hover:border-line-strong hover:shadow-sm'
                }`}
              >
                <div className="relative bg-studio p-3 flex justify-center">
                  <div className="w-full max-w-[165px] rounded-xl overflow-hidden bg-black aspect-[390/844] ring-1 ring-white/10">
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      poster={withBase(
                        `videos/storyboards/posters/${sb.videoFile.replace(/\.mp4$/, '.jpg')}`,
                      )}
                      className="w-full h-full object-contain bg-black"
                      src={withBase(`videos/storyboards/${sb.videoFile}`)}
                    />
                  </div>
                  <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/70 text-[11px] font-mono text-emerald-300">
                    #{String(sb.id).padStart(2, '0')}
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-pine font-semibold">
                      {sb.category}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-ink leading-snug">
                      {sb.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                      {sb.summary}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => selectStoryboard(sb.id, true, true)}
                    className={`mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-pine text-white'
                        : 'bg-paper-alt text-ink hover:bg-pine-soft hover:text-pine-ink'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {isActive ? 'Playing in Theater' : 'Watch in Theater'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </SiteLayout>
  )
}
