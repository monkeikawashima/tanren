// 進み具合の表示（mod）。.loop/state.json を読み、案件・媒体・工程・回数・採点の費用をプロンプトの下の1行に出す。
// 関門 hook（hooks/design-gate.mjs）はターンの終わりに state.json を書き換えるので、10秒ごとに読み直す。
// 表示できる画面（ターミナル・デスクトップアプリ・VS Code）でだけ見える。cloud や claude -p では何も出ないが、害もない。

import type { Register } from 'claude-code'

type Part = { path: string; medium: string }
type Counter = { iteration?: number; max?: number; done?: boolean }
type State = {
  status?: string
  job?: string
  request?: string
  medium?: string
  phase?: string
  parts?: Part[]
  current?: number
  build?: Counter
  usertest?: Counter
  figma?: Counter & { enabled?: boolean }
  cost_usd?: number
  started_at?: string
}

const PHASE: Record<string, string> = {
  build: '磨き',
  usertest: '操作テスト',
  figma: 'Figma の検品',
  delivering: '納品',
}

// 表示する1行。動いていない（done・stopped・state.json がない）ときは undefined で消す
export function line(s: State | null, nowMs: number): string | undefined {
  if (!s || !['planning', 'running', 'delivering'].includes(s.status ?? '')) return undefined
  const request = (s.request ?? s.job ?? '').split('/').pop()
  const bits = [`tanren：${request}`]
  if (s.parts && s.parts.length > 1) {
    const i = s.current ?? 0
    bits.push(`${s.medium}（${i + 1}/${s.parts.length}）`)
  } else if (s.medium) {
    bits.push(s.medium)
  }
  if (s.status === 'planning') {
    bits.push('方向性の探索')
  } else {
    const phase = s.status === 'delivering' ? 'delivering' : s.phase ?? 'build'
    const c = phase === 'build' ? s.build : phase === 'usertest' ? s.usertest : phase === 'figma' ? s.figma : undefined
    bits.push(c?.iteration && c.max ? `${PHASE[phase] ?? phase} ${c.iteration}/${c.max}` : PHASE[phase] ?? phase)
  }
  if (typeof s.cost_usd === 'number' && s.cost_usd > 0) bits.push(`採点 $${s.cost_usd.toFixed(2)}`)
  if (s.started_at) {
    const min = Math.max(0, Math.round((nowMs - Date.parse(s.started_at)) / 60000))
    bits.push(`${min}分`)
  }
  return bits.join(' · ')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const refresh = async () => {
      let state: State | null = null
      try {
        state = JSON.parse(await $.fs.read('.loop/state.json')) as State
      } catch {
        state = null
      }
      $.ui.status(line(state, await $.clock.now()))
    }
    await refresh()
    $.clock.every(10_000, refresh)
    return next(e)
  })
}
