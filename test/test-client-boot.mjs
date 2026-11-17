// Regression test for the crash that broke the desktop app boot:
//
//   client-modules: duplicate factory registration for "dsh-computer-use"
//
// DSH's client loader keys factories by the module id it derives from the bundle
// URL (= the PACKAGE NAME) and looks that id up after executing the script. When
// the script registers under a different id the row looks unregistered, so the
// loader retries a fallback URL and EXECUTES THE SCRIPT A SECOND TIME; the second
// registration is a hard duplicate-factory error that fails the whole web boot.
//
// This test reproduces both halves: the id must equal the package name, and a
// second execution must not throw.
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CLIENT = process.argv[2] ?? join(ROOT, 'lib', 'client.js')
const source = await readFile(CLIENT, 'utf8')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
console.log(`bundle under test: ${CLIENT}\n`)

let failures = 0
const fail = (message) => { console.log(`FAIL: ${message}`); failures++ }

// --- fake DSH client-modules loader: rejects a duplicate id, exactly like DSH ---
const registrations = new Map()
const sandbox = {
  console,
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  CustomEvent: class {},
}
sandbox.globalThis = sandbox
sandbox.window = {
  __ModuleLoader__: {
    load(registration) {
      const id = registration.id
      if (registrations.has(id)) {
        throw new Error(`client-modules: duplicate factory registration for "${id}" (bundle executed twice without invalidate?)`)
      }
      registrations.set(id, registration)
    },
  },
  dispatchEvent: () => {},
}
sandbox.self = sandbox

const context = vm.createContext(sandbox)

// --- 1. first execution: the preferred bundle URL ---
try {
  vm.runInContext(source, context, { filename: 'client.js' })
} catch (error) {
  fail(`first execution threw: ${error.message}`)
}

// --- 2. the loader found no factory under the expected id? then it retries the
//        fallback URL, which re-executes the very same script ---
const expectedId = pkg.name
if (!registrations.has(expectedId)) {
  fail(`nothing registered under the package name "${expectedId}" — the loader would retry a fallback URL`)
}
if (registrations.size !== 1) {
  fail(`expected exactly 1 registration, got ${registrations.size}: ${[...registrations.keys()].join(', ')}`)
} else {
  console.log(`OK   registered id = "${[...registrations.keys()][0]}" (matches package name)`)
}

try {
  vm.runInContext(source, context, { filename: 'client.js' })
  console.log('OK   second execution is inert (no duplicate registration)')
} catch (error) {
  fail(`second execution threw: ${error.message}`)
}

if (registrations.size !== 1) fail(`registration count changed to ${registrations.size} after re-execution`)

// --- 3. the factory must expose apply + inject for the cordis client runner ---
const registration = registrations.get(expectedId)
if (registration === undefined) {
  fail('no registration available to inspect')
} else {
  try {
    const React = {
      createElement: () => ({}),
      useState: (v) => [v, () => {}],
      useEffect: () => {},
    }
    const exported = registration.factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require("${name}")`)
    })
    if (typeof exported.apply !== 'function') fail('factory exports no apply()')
    else console.log('OK   factory exports apply()')
    if (!Array.isArray(exported.inject)) fail('factory exports no inject array')
    else console.log(`OK   factory exports inject = [${exported.inject.join(', ')}]`)
  } catch (error) {
    fail(`factory threw: ${error.message}`)
  }
}

// --- 4. the bundle must not reference an endpoint the host does not serve ---
if (source.includes('/api/computer/')) fail('client still fetches /api/computer/* which no host route serves')

console.log(failures === 0 ? '\nPASS — this bundle can no longer fail the web boot' : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
