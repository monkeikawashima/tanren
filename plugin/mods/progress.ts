// 進み具合の表示（mod）。.loop/state.json を読み、案件・媒体・工程・回数・採点の費用をプロンプトの下の1行に出す。
// 関門 hook（hooks/design-gate.mjs）はターンの終わりに state.json を書き換えるので、10秒ごとに読み直す。
// 表示できる画面（ターミナル・デスクトップアプリ・VS Code）でだけ見える。cloud や claude -p では何も出ないが、害もない。

import type { Register } from 'claude-code'

type Part = { path: string; medium: string }
type Lane = { name: string; path: string; medium: string; state: string }
type Counter = { iteration?: number; max?: number; done?: boolean }
type State = {
  status?: string
  job?: string
  request?: string
  medium?: string
  phase?: string
  parts?: Part[]
  lanes?: Lane[]
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
  finish: '仕上げ',
  review: '最後の確認待ち',
}

// 表示する1行。動いていない（done・stopped・state.json がない）ときは undefined で消す
// レーン（上位案の並列の磨き）のときは、レーンごとの工程と回数を並べる（lanes はレーンの状態ファイルを読んだもの）
export function line(s: State | null, nowMs: number, lanes: (State & { name?: string })[] = []): string | undefined {
  if (!s || !['planning', 'running', 'delivering', 'review'].includes(s.status ?? '')) return undefined
  const request = (s.request ?? s.job ?? '').split('/').pop()
  const bits = [`tanren：${request}`]
  if (s.lanes?.length) {
    if (s.status === 'review') bits.push(PHASE.review)
    else bits.push(lanes.map((l) => {
      const phase = l.status === 'review' ? 'review' : l.phase ?? 'build'
      const c = phase === 'build' ? l.build : phase === 'usertest' ? l.usertest : undefined
      return `${l.name} ${c?.iteration && c.max ? `${PHASE[phase] ?? phase} ${c.iteration}/${c.max}` : (phase === 'review' ? '待機' : PHASE[phase] ?? phase)}`
    }).join('／'))
    const cost = lanes.reduce((a, l) => a + (l.cost_usd || 0), 0)
    if (cost > 0) bits.push(`採点 $${cost.toFixed(2)}`)
  } else if (s.parts && s.parts.length > 1) {
    const i = s.current ?? 0
    bits.push(`${s.medium}（${i + 1}/${s.parts.length}）`)
  } else if (s.medium) {
    bits.push(s.medium)
  }
  if (s.lanes?.length) {
    // 上で書いた
  } else if (s.status === 'planning') {
    bits.push('方向性の探索')
  } else {
    const phase = s.status === 'delivering' ? 'delivering' : s.phase ?? 'build'
    const c = phase === 'build' ? s.build : phase === 'usertest' ? s.usertest : phase === 'figma' ? s.figma : undefined
    bits.push(c?.iteration && c.max ? `${PHASE[phase] ?? phase} ${c.iteration}/${c.max}` : PHASE[phase] ?? phase)
  }
  if (!s.lanes?.length && typeof s.cost_usd === 'number' && s.cost_usd > 0) bits.push(`採点 $${s.cost_usd.toFixed(2)}`)
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
      const lanes: (State & { name?: string })[] = []
      try {
        state = JSON.parse(await $.fs.read('.loop/state.json')) as State
        for (const l of state?.lanes ?? []) {
          try { lanes.push({ ...(JSON.parse(await $.fs.read(l.state)) as State), name: l.name }) } catch {}
        }
      } catch {
        state = null
      }
      $.ui.status(line(state, await $.clock.now(), lanes))
    }
    await refresh()
    $.clock.every(10_000, refresh)
    return next(e)
  })
}
