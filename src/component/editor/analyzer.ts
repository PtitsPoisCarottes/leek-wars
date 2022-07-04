import { AI } from '@/model/ai'
import { fileSystem } from '@/model/filesystem'
import { LeekWars } from '@/model/leekwars'
import Vue from 'vue'
import { AIItem, Folder } from './editor-item'
import { Problem } from './problem'

class Analyzer {

	public enabled: boolean = false
	public running: number = 0
	public problems: {[key: number]: {[key: string]: Problem[]}} = {}
	public error_count: number = 0
	public warning_count: number = 0
	public todo_count: number = 0
	public promise!: Promise<any>

	private initialized: boolean = false
	private GeneratorAnalyze!: Function
	private GeneratorComplete!: Function
	private GeneratorHover!: Function
	private GeneratorRegister!: Function
	private GeneratorAddEntrypoint!: Function
	private getExceptionMessage!: Function
	private GeneratorDelete!: Function

	public init() {
		this.enabled = true
		if (this.initialized) { return Promise.resolve() }
		this.initialized = true

		this.promise = new Promise((resolve, reject) => {
			const Module: any = {
				onRuntimeInitialized: () => {
					// console.log("Module initialized", Module)
					Module.ccall('init')
					this.GeneratorAnalyze = Module.cwrap('analyze', 'string', ['boolean', 'string', 'string', 'boolean'])
					this.GeneratorComplete = Module.cwrap('complete', 'string', ['boolean', 'string', 'number'])
					this.GeneratorHover = Module.cwrap('hover', 'string', ['boolean', 'string', 'number', 'boolean'])
					this.GeneratorRegister = Module.cwrap('register_', 'void', ['boolean', 'string'])
					this.GeneratorAddEntrypoint = Module.cwrap('addEntrypoint', 'void', ['boolean', 'string', 'boolean', 'string'])
					this.getExceptionMessage = Module.cwrap('getExceptionMessage', 'string', ['number'])
					this.GeneratorDelete = Module.cwrap('delete_', 'string', ['string'])

					// console.log(this.GeneratorAnalyze(false, "Fight.toto"))
					// console.log(this.GeneratorComplete(false, "Fight.getEntity().name", 18))

					resolve()
				}
			}
			window.Module = Module
			this.loadJs('/analyzer.js')
		})
	}

	public updateCount() {
		let errors = 0
		let warnings = 0
		let todos = 0
		for (const entrypoint in this.problems) {
			for (const ai in this.problems[entrypoint]) {
				const problems = this.problems[entrypoint][ai]
				// console.log(this.problems[ai])
				for (const problem of problems) {
					if (problem.level === 0) { errors++ }
					else if (problem.level === 1) { warnings++ }
					else if (problem.level === 2) { todos++ }
				}
			}
		}
		this.error_count = errors
		this.warning_count = warnings
		this.todo_count = todos
	}

	public hover(ai: AI, position: number) {

		if (!this.enabled) { return Promise.reject() }

		// console.log("Hover", ai.path)

		// console.time("hover")
		return this.promise.then(() => {
			try {
				const data = this.GeneratorHover(ai.version, ai.path, position, ai.entrypoint)
				const result = JSON.parse(data)
				// console.log(result)
				return Promise.resolve(result)
			} catch (e) {
				console.error(this.getExceptionMessage(e))
				return Promise.reject()
			}
		})
	}

	public analyze(ai: AI, code: string) {

		if (!this.enabled) { return Promise.reject() }

		// console.log("Chain promise")
		return this.promise.then(() => {

			this.registerEntrypoints(ai)

			console.log("🔥 Analyze", ai.path, {entrypoint: ai.entrypoint})

			this.running = 1
			return new Promise((resolve, reject) => setTimeout(() => {
				try {
					console.time("analyze")
					const result = JSON.parse(this.GeneratorAnalyze(ai.version, ai.path, code, ai.entrypoint))
					console.log(result)
					for (const path in result) {
						const problems = result[path]
						problems.sort((a: any, b: any) => {
							return a[0] - b[0]
						})
						// this.setAIProblems(path, problems)
					}
					return resolve(result)
				} catch (e) {
					const problems = [ [0, 0, 0, 0, 1, "ANALYZER_CRASHED"] ]
					// this.setAIProblems(ai.path, problems)
					try {
						// console.error(this.getExceptionMessage(e))
					} catch (e2) {
						// nothing
					}
					return reject()
				} finally {
					this.running = 0
					this.updateCount()
					console.timeEnd("analyze")
				}
			}))
		})
	}

	public register(ai: AI) {

		if (!this.enabled) { return Promise.reject() }

		// console.log("Register", ai.path)

		return this.promise.then(() => {

			this.GeneratorRegister(ai.version, ai.path)

			this.registerEntrypoints(ai)

			return Promise.resolve()
		})
	}

	public complete(ai: AI, position: number) {

		if (!this.enabled) { return Promise.reject() }

		// console.log("Complete", ai.path)

		console.time("complete")
		const data = this.GeneratorComplete(ai.version, ai.path, position)
		console.timeEnd("complete")
		// console.log("complete", data)
		const result = JSON.parse(data)
		// console.log(result)
		// this.problems[ai] = result
		// this.error_count += result.errors.length
		// console.log(this.error_count)

		return Promise.resolve(result)
	}

	public delete(ai: AI) {

		if (!this.enabled) { return Promise.reject() }

		return this.promise.then(() => {

			console.log("🔥 Delete", ai.path)

			this.running = 1
			return new Promise((resolve, reject) => setTimeout(() => {
				try {
					console.time("delete")
					const result = JSON.parse(this.GeneratorDelete(ai.path))
					console.log(result)
					for (const path in result) {
						const problems = result[path]
						problems.sort((a: any, b: any) => {
							return a[0] - b[0]
						})
						// this.setAIProblems(path, problems)
					}
					return resolve(result)
				} catch (e) {
					const problems = [ [0, 0, 0, 0, 1, "ANALYZER_CRASHED"] ]
					// this.setAIProblems(ai.path, problems)
					try {
						// console.error(this.getExceptionMessage(e))
					} catch (e2) {
						// nothing
					}
					return reject()
				} finally {
					this.running = 0
					this.updateCount()
					console.timeEnd("delete")
				}
			}))
		})
	}

	public registerEntrypoints(ai: AI) {
		for (const entrypoint_id of ai.entrypoints) {
			const entrypoint = fileSystem.ais[entrypoint_id]
			if (entrypoint) {
				// console.log("Add entrypoint", ai.path, "==>", entrypoint.path)
				this.GeneratorAddEntrypoint(ai.version, ai.path, entrypoint.version, entrypoint.path)
			}
		}
	}

	public setProblems(entrypoint: number, ai: AI, problems: any) {
		// console.log("[Analyzer] set ai problems", entrypoint, ai, problems)
		if (!(entrypoint in this.problems)) {
			Vue.set(this.problems, entrypoint, {})
		}
		Vue.set(this.problems[entrypoint], ai.path, problems)
		Vue.set(ai.problems, entrypoint, problems)
		this.updateAiErrors(ai)
	}

	public removeProblems(entrypoint: AI) {
		for (const ai_id in fileSystem.ais) {
			const ai = fileSystem.ais[ai_id]
			if (ai.problems) {
				Vue.delete(ai.problems, entrypoint.id)
			}
		}
		Vue.delete(this.problems, entrypoint.id)
	}

	public updateAiErrors(ai: AI) {
		// console.log("update ai errors", ai)
		let errors = 0
		let warnings = 0
		let todos = 0
		for (const entrypoint in ai.problems) {
			errors += ai.problems[entrypoint].filter(p => p.level === 0).length
			warnings += ai.problems[entrypoint].filter(p => p.level === 1).length
			todos += ai.problems[entrypoint].filter(p => p.level === 2).length
		}
		Vue.set(ai, "errors", errors)
		Vue.set(ai, "warnings", warnings)
		Vue.set(ai, "todos", todos)

		// Update parent folders
		let current = fileSystem.folderById[ai.folder] as Folder | null
		while (current) {
			current.errors = current.items.reduce((s, i) => s + (i.folder ? (i as Folder).errors : (i as AIItem).ai.errors), 0)
			current.warnings = current.items.reduce((s, i) => s + (i.folder ? (i as Folder).warnings : (i as AIItem).ai.warnings), 0)
			current.todos = current.items.reduce((s, i) => s + (i.folder ? (i as Folder).todos : (i as AIItem).ai.todos), 0)
			current = current.id === 0 ? null : fileSystem.folderById[current.parent]
		}
	}

	private loadJs(url: string) {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`head > script[ src = "${url}" ]`) !== null) {
				console.warn(`script already loaded: ${url}`)
				resolve()
			}
			const script = document.createElement("script")
			script.src = url
			script.onload = resolve
			script.onerror = (reason) => {
				reject(reason)
			}
			document.head.appendChild(script)
		})
	}
}

export default Analyzer