import { useEffect } from 'react'
import Lenis from 'lenis'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { WhySuiteMail } from './components/WhySuiteMail'
import { ProductShowcase } from './components/ProductShowcase'
import { Features } from './components/Features'
import { OpenSource } from './components/OpenSource'
import { CtaFooter } from './components/CtaFooter'
import './App.css'

function App() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({
      autoRaf: true,
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    })

    return () => lenis.destroy()
  }, [])

  return (
    <div className="relative min-h-screen">
      <Navbar />
      <main>
        <Hero />
        <WhySuiteMail />
        <ProductShowcase />
        <Features />
        <OpenSource />
        <CtaFooter />
      </main>
    </div>
  )
}

export default App
