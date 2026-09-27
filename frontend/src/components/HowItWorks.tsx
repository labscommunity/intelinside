import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CellGrid, PillTabs, Section } from '@/components/frame'
import { useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'

/*
  How a number gets on the board, in one row under the hero. There are two ways in — the form and a coding agent —
  and only one is shown at a time: the board has to start above the fold, and two paths side by side cost three
  hundred pixels nobody reads. Both tabs carry three steps and one button, so the row is the same height either way
  and nothing below it moves when someone flips the tab.
*/

/** One cell of the row: the steps and the button share it, so all four columns line up. */
const cell = 'flex min-w-0 gap-3 bg-background p-5 md:px-6'

type Path = 'hand' | 'agent'

const STEPS: Record<Path, { title: string; hint: string }[]> = {
  hand: [
    { title: 'Sign in with GitHub', hint: 'Your handle carries the results.' },
    { title: 'Register your rig', hint: 'The machine the model ran on.' },
    { title: 'Post the tok/s', hint: 'One model, one runtime, one machine.' },
  ],
  agent: [
    { title: 'Create an API key', hint: 'Choose what your agent can manage.' },
    { title: 'Give your agent the docs', hint: 'Save the key in its secret settings.' },
    { title: 'Ask it to submit your run', hint: 'It can register the rig and runtime too.' },
  ],
}

export function HowItWorks() {
  const { user, requestSignIn } = useSession()
  const [path, setPath] = useState<Path>('hand')
  const agent = path === 'agent'
  // The settings page contains the key flow and copyable agent instructions.
  const to = agent ? '/settings/api-keys' : '/submit'
  const cta = (
    <>
      {agent ? <Terminal data-icon="inline-start" /> : <Plus data-icon="inline-start" />} {agent ? 'Connect your agent' : 'Submit a result'}
    </>
  )
  return (
    <Section
      label="How it works"
      action={
        <PillTabs<Path>
          value={path}
          onChange={setPath}
          items={[
            { value: 'hand', label: 'By hand' },
            { value: 'agent', label: 'With an agent' },
          ]}
        />
      }
    >
      <CellGrid cols={4} count={4}>
        {/* `contents` keeps the three steps a real ordered list while their items sit in the four-column grid
            alongside the button, which is not a step. */}
        <ol className="contents">
          {STEPS[path].map((step, i) => (
            <li key={step.title} className={cell}>
              <span className="w-5 shrink-0 font-mono text-xs leading-5 text-muted-foreground">0{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{step.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground text-pretty">{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className={cn(cell, 'items-center')}>
          {user ? (
            <Button variant="outline" size="lg" render={<Link to={to} />} nativeButton={false}>
              {cta}
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={() => requestSignIn(to)}>
              {cta}
            </Button>
          )}
        </div>
      </CellGrid>
    </Section>
  )
}
