/**
 * Client half of dsh-computer-use —— 右侧栏的「电脑控制」面板
 *
 * Uses DSH's __ModuleLoader__ + ctx.inject() to contribute UI.
 */

;(() => {
// The bundle is addressed by its PACKAGE NAME. client-modules derives the
// expected module id from the bundle URL and looks the factory up by that id;
// registering under any other id makes the row look unregistered, so the loader
// retries a fallback URL and executes this script a second time — and a second
// registration is a hard duplicate-factory error that fails the entire boot.
const MODULE_ID = 'dsh-computer-use'

// Belt and braces: if anything re-executes this bundle, never register twice.
if (globalThis.__DSH_COMPUTER_USE_CLIENT_LOADED__ === true) return
globalThis.__DSH_COMPUTER_USE_CLIENT_LOADED__ = true

const TAB_KIND = 'computer-use'
const TAB_ID = 'dsh-computer-use:computer-use'

window.__ModuleLoader__.load({
  id: MODULE_ID,
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const C = {
      bg: 'var(--dsw-alias-bg-base)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      accent: 'var(--dsw-alias-brand-primary, #5a7cff)',
      active: '#ff9800',
      success: '#4caf50',
    }

    function ComputerUsePanel() {
      const [status, setStatus] = React.useState('就绪')
      const [paused, setPaused] = React.useState(false)
      const [windows, setWindows] = React.useState([])
      const [glowEnabled, setGlowEnabled] = React.useState(true)
      const [autoScreenshot, setAutoScreenshot] = React.useState(true)
      const [authMode, setAuthMode] = React.useState('per-app')

      // Live state from the host route this plugin registers.
      React.useEffect(() => {
        let cancelled = false
        const load = () =>
          fetch('/dsh-computer-use/state')
            .then((r) => r.json())
            .then((data) => {
              if (cancelled) return
              if (Array.isArray(data.windows)) setWindows(data.windows)
              const isPaused = data.paused === true
              setPaused(isPaused)
              setStatus(isPaused ? '已暂停（按 Esc 继续）' : '就绪')
            })
            .catch(() => {})
        load()
        const timer = setInterval(load, 4000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [])

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, color: C.text, padding: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}` } },
          h('span', {
            style: {
              width: 10,
              height: 10,
              borderRadius: 10,
              background: paused ? C.active : C.success,
            },
          }),
          h('span', { style: { fontSize: 13, fontWeight: 500 } }, status),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginBottom: 12 } },
          h('span', { style: btnStyle(C.accent) }, '按 Esc 暂停 / 继续'),
        ),
        h(
          'div',
          { style: { flex: '1 1 auto', overflowY: 'auto', marginBottom: 12 } },
          h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 6 } }, `窗口列表 (${windows.length})`),
          windows.length > 0
            ? windows.map((w, i) =>
                h(
                  'div',
                  {
                    key: i,
                    style: {
                      padding: '4px 8px',
                      fontSize: 12,
                      borderBottom: `1px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  },
                  w.title,
                ),
              )
            : h('div', { style: { fontSize: 11, color: C.dim } }, '暂无窗口'),
        ),
        h(
          'div',
          { style: { borderTop: `1px solid ${C.border}`, paddingTop: 12 } },
          h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 8 } }, '设置'),
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6 } },
            h('input', { type: 'checkbox', checked: glowEnabled, onChange: (e) => setGlowEnabled(e.target.checked) }),
            '显示橙色光晕',
          ),
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6 } },
            h('input', { type: 'checkbox', checked: autoScreenshot, onChange: (e) => setAutoScreenshot(e.target.checked) }),
            '操作后自动截图',
          ),
          h(
            'label',
            { style: { display: 'block', fontSize: 12, marginBottom: 6 } },
            '授权方式:',
            h(
              'select',
              {
                value: authMode,
                onChange: (e) => setAuthMode(e.target.value),
                style: { marginLeft: 8, padding: '2px 6px', fontSize: 12 },
              },
              h('option', { value: 'per-app' }, '按应用授权'),
              h('option', { value: 'allow-all' }, '全部允许'),
            ),
          ),
        ),
      )
    }

    function btnStyle(tint) {
      const isAccent = tint !== 'transparent'
      return {
        border: `1px solid ${isAccent ? tint : C.border}`,
        background: isAccent ? `color-mix(in srgb, ${tint} 22%, transparent)` : 'transparent',
        color: isAccent ? C.text : C.dim,
        borderRadius: 8,
        fontSize: 12.5,
        padding: '5px 14px',
      }
    }

    function ComputerUseBody() {
      return h(ComputerUsePanel)
    }

    function ComputerUseTitle() {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', { 'aria-hidden': 'true' }, '🖥️'),
        h('span', null, '电脑控制'),
      )
    }

    const inject = ['slots', 'sidebarRightTabs']

    function apply(ctx) {
      // Never let a contribution failure escape: an exception here can fail the
      // whole web boot, and a missing sidebar slot is a far smaller problem than
      // an app that will not start.
      try {
        ctx.inject(['sidebarRightTabs'], (scoped) => {
          scoped.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            title: () => '电脑控制',
            guide: [
              {
                id: TAB_KIND,
                kind: TAB_KIND,
                order: 120,
                title: () => '电脑控制',
                description: () => '截图、鼠标、键盘、窗口控制',
                icon: () => h('span', { style: { fontSize: 16 } }, '🖥️'),
              },
            ],
          })
        })
      } catch (error) {
        console.warn('computer-use: sidebar tab registration failed', error)
      }
      try {
        ctx.inject(['slots'], (scoped) => {
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ComputerUseBody),
          )
          scoped.slots.inject('sidebar.right.pane.tab.title', () =>
            scoped.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, ComputerUseTitle),
          )
        })
      } catch (error) {
        console.warn('computer-use: sidebar pane registration failed', error)
      }
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
})()
