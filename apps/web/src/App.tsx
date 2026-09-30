import { uk } from './i18n';
import { ThemeProvider, ThemeToggle } from './ui/theme';
import { CardFace } from './ui/Card';

/** Каркас застосунку: шапка й основна область. */
export function App() {
  return (
    <ThemeProvider>
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">{uk.appTitle}</h1>
          <ThemeToggle />
        </header>
        <main className="app__main">
          <section className="home">
            <div className="home__cards" aria-hidden="true">
              <CardFace card={{ kind: 'standard', suit: 'spades', rank: 14 }} />
              <CardFace card={{ kind: 'standard', suit: 'hearts', rank: 13 }} />
              <CardFace card={{ kind: 'joker', index: 0 }} />
            </div>
            <p className="home__tagline">{uk.home.tagline}</p>
          </section>
        </main>
      </div>
    </ThemeProvider>
  );
}
