import { motion } from 'framer-motion'
import { Download } from 'lucide-react'

export function CtaFooter() {
  return (
    <section id="download" className="relative">
      {/* CTA */}
      <div className="relative py-24 md:py-32 px-6 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-accent/[0.06] rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-3xl mx-auto text-center">
          <motion.h2
            className="text-3xl md:text-4xl lg:text-5xl font-light tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="gradient-text">Try SuiteMail</span>
            <span className="text-text-primary"> today</span>
          </motion.h2>

          <motion.p
            className="text-text-secondary text-lg max-w-md mx-auto mb-10 leading-relaxed"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            Get the latest desktop installers and the Android preview APK on GitHub.
          </motion.p>

          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <a
              href="https://github.com/MisterTea/SuiteMail/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              <Download size={17} />
              Download for Free
            </a>
          </motion.div>

          <motion.div
            className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 text-sm text-text-secondary"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <span>Windows</span>
            <span className="w-1 h-1 rounded-full bg-text-muted" />
            <span>macOS</span>
            <span className="w-1 h-1 rounded-full bg-text-muted" />
            <span>Linux</span>
            <span className="w-1 h-1 rounded-full bg-text-muted" />
            <span>Android preview</span>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={import.meta.env.BASE_URL + 'logo-white.svg'} alt="SuiteMail" className="w-5 h-5 rounded" />
            <span className="text-sm text-text-muted">SuiteMail</span>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-5 text-sm text-text-secondary">
            <a href="https://github.com/MisterTea/SuiteMail" target="_blank" rel="noopener noreferrer" className="hover:text-text-secondary transition-colors no-underline">
              GitHub
            </a>
            <a href="https://github.com/MisterTea/SuiteMail/releases/latest" target="_blank" rel="noopener noreferrer" className="hover:text-text-secondary transition-colors no-underline">
              Releases
            </a>
            <a href="https://github.com/MisterTea/SuiteMail/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="hover:text-text-secondary transition-colors no-underline">
              Apache 2.0
            </a>
            <a href="https://github.com/MisterTea/SuiteMail/blob/main/SECURITY.md" className="hover:text-text-primary">
              Security and privacy
            </a>
          </div>
        </div>
      </footer>
    </section>
  )
}
