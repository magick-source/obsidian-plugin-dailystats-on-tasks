import { Plugin, TFile, TAbstractFile, Workspace } from "obsidian";
import { getAllDailyNotes, getDailyNote, getDateUID } from "obsidian-daily-notes-interface";

export default class ActiveNowPlugin extends Plugin {
	private TARGET_FOLDER = "Projects";
	private ACTIVE_TAG = "#active-now";
	private debounceTimer: any;

	async onload() {
		this.addCommand({
			id: "update-active-now-stats",
			name: "Update today’s active-now stats",
			callback: () => this.run(),
		});

		const onChange = (taf: TAbstractFile) => {
			console.log("onChange Called!")
			if (taf instanceof TFile) {
				clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => {
					this.onFileChange(taf);
				}, 500); // 500ms after a change
				console.log("Scheduled onFileChange!");
			}
		};
		this.registerEvent(this.app.vault.on('create', onChange));
		this.registerEvent(this.app.vault.on('modify', onChange));

		console.log("DailyStatsOnTasks is now loaded")
	}

	async run() {
		const startts = Date.now();
		console.log(startts, "Starting dailystats-on-tasks run");
		const todayNote = await this.getTodayNote();
		if (todayNote) {
	    const stats = await this.computeStats();

	    if (stats)
			  await this.updateFrontmatter(todayNote, stats);
		}

		const endts = Date.now();
		console.log(endts, "Done updating stats");
	}


  //------------------------------
  // Check Available plugins
  //------------------------------

  private getTasksAPI(): any | null {
		if ((this.app as any).plugins.enabledPlugins.has("obsidian-tasks-plugin")) {
			return (this.app as any).plugins.plugins["obsidian-tasks-plugin"];
		}

		return null;
  }

  private getDataviewAPI(): any | null {
		if ((this.app as any).plugins.enabledPlugins.has("dataview")) {
			return (this.app as any).plugins.plugins["dataview"].api;
		}

		return null;
  }


  //------------------------------
  // Helper methods
  //------------------------------

  private hasNoteTag(filePath: string, tag: string): boolean {
  	const file = this.app.vault.getAbstractFileByPath(filePath);
  	if (!(file instanceof TFile)) return false;

  	const cache = this.app.metadataCache.getFileCache(file);
  	const tags = cache?.tags ?? [];

  	return tags.some(t => t.tag === tag);
  }


  //------------------------------
  // Using Tasks Plugin
  //------------------------------

  private async computeStatsWithTasksPlugin(): Promise<{
  	total: number;
  	done: number;
  } | null> {
  	const tasksApi = this.getTasksAPI();
  	if (!tasksApi) return null;

  	const allTasks = await tasksApi.getTasks();

  	let total = 0;
  	let done = 0;

  	for (const task of allTasks) {
  		// Folder filter: FROM "Projects"
  		if (!task.path.startsWith("Projects/")) continue;

  		// Note-level tag filter: and #active-now
  		if (!this.hasNoteTag(task.path, "#active-now")) continue;

  		total++;
  		if (task.isDone) {
  			done++;
  		}
  	}

  	const percent = total === 0
  		? 0
  		: Math.round((done / total) * 100);

  	return { total, done };
  }

  //------------------------------
  // Using Dataview
  //------------------------------

  private async computeStatsWithDataview(): Promise<{
  	total: number;
  	done: number;
  } | null> {
  	const dv = this.getDataviewAPI();
  	if (!dv) return null;

  	// Equivalent to: FROM "Projects" and #active-now
  	const pages = dv
  		.pages('"Projects"')
  		.where((p: any) => p.file.tags?.includes("#active-now"));

  	let total = 0;
  	let done = 0;

  	for (const page of pages) {
  		for (const task of page.file.tasks) {
  			total++;
  			if (task.completed) {
  				done++;
  			}
  		}
  	}

  	return { total, done };
  }

  //------------------------------
  // FindPlugin and calculate stats
  //------------------------------

  private async computeStats(): Promise<{
    total: number;
    done: number;
    percent: number;
  }| null> {
    const fromTasks = await this.computeStatsWithTasksPlugin();
    const stats = fromTasks ?? await this.computeStatsWithDataview();

    if (stats == null)
      return null;

    const percent = stats.total === 0
      ? 100
      : Math.round((stats.done / stats.total) * 100);
    return {
      ...stats,
      percent: percent
    };
  }

	// -----------------------------
	// Daily note
	// -----------------------------

	private async getTodayNote(): Promise<TFile | null> {
		const allNotes = getAllDailyNotes();
		const todayNote = getDailyNote(window.moment(), allNotes);

		return todayNote;
	}

	// -----------------------------
	// Frontmatter update
	// -----------------------------

	async updateFrontmatter(
		note: TFile,
		stats: { total: number; done: number; percent: number }
	) {
		await this.app.fileManager.processFrontMatter(note, (fm) => {
			fm["dailystats-total"] = stats.total;
			fm["dailystats-done"] = stats.done;
			fm["dailystats-percent"] = stats.percent;
		});
	}

	private async onFileChange(file: TFile) {
		if (!file.path.endsWith(".md")) {
			console.log("Skiping onFileChange - not .md", file.path);
			return;
		}
		const todayNote = (await this.getTodayNote())?.path ?? "no-such-note-exists";

		if (!file.path.startsWith(this.TARGET_FOLDER+"/")
				&& (file.path !== todayNote)
			) {
				console.log("Skiping onFileChange - not a good one", file.path, todayNote);
				return;
		}

		this.run();
	}

	onunload() {
		console.log("DailyStatsOnTasks plugin unloaded");
	}
}
