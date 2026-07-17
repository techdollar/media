#!/usr/bin/env npx tsx
/**
 * Rename files in ./logotypes to match the naming used in ./companies.
 *
 * Rules:
 *  1. If a logotype corresponds to a company that also exists in ./companies,
 *     its name becomes CHARACTER-FOR-CHARACTER identical to the companies file.
 *       companies/1X.png          -> logotypes/1X.png        (not 1x.png)
 *       companies/eleven-labs.png -> logotypes/eleven-labs.png (not elevenlabs.png)
 *  2. Every other logotype is slugified the same way the companies names are:
 *       "Property 1=Abnormal Security.png" -> "abnormal-security.png"
 *       - drop the "Property 1=" prefix
 *       - transliterate accents (Ualá -> uala)
 *       - lowercase, turn runs of non-alphanumerics into a single hyphen, trim hyphens
 *
 * Matching between the two folders is done on a "loose key": lowercase with every
 * non-alphanumeric character removed. So "1X", "eleven-labs" and "ElevenLabs" all
 * collapse to the same key and can be paired up.
 *
 * Usage:
 *   npx tsx rename-logotypes.ts            # dry run: print what would change
 *   npx tsx rename-logotypes.ts --apply    # actually rename the files
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = __dirname;
const COMPANIES_DIR = path.join(ROOT, "companies");
const LOGOTYPES_DIR = path.join(ROOT, "logotypes");
const PREFIX = "Property 1=";

/** Loose key for pairing files across folders: lowercase, alphanumerics only. */
function looseKey(fileName: string): string {
	let stem = path.parse(fileName).name;
	if (stem.startsWith(PREFIX)) stem = stem.slice(PREFIX.length);
	return stem
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "") // strip diacritics
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

/** Default slug, matching the companies naming style. */
function slugify(fileName: string): string {
	const ext = path.parse(fileName).ext.toLowerCase();
	let stem = path.parse(fileName).name;
	if (stem.startsWith(PREFIX)) stem = stem.slice(PREFIX.length);
	stem = stem
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return stem + ext;
}

function listPng(dir: string): string[] {
	return fs
		.readdirSync(dir)
		.filter(
			(f) =>
				fs.statSync(path.join(dir, f)).isFile() &&
				f.toLowerCase().endsWith(".png"),
		)
		.sort();
}

/** Case-only renames are done via a temp name so they work on case-insensitive FS. */
function renameFile(dir: string, from: string, to: string): void {
	const src = path.join(dir, from);
	const dst = path.join(dir, to);
	if (from.toLowerCase() === to.toLowerCase() && from !== to) {
		const tmp = path.join(dir, `__tmp__${Date.now()}__${to}`);
		fs.renameSync(src, tmp);
		fs.renameSync(tmp, dst);
	} else {
		fs.renameSync(src, dst);
	}
}

function main(): void {
	const apply = process.argv.includes("--apply");

	for (const dir of [COMPANIES_DIR, LOGOTYPES_DIR]) {
		if (!fs.existsSync(dir)) {
			console.error(`Folder not found: ${dir}`);
			process.exit(1);
		}
	}

	// key -> exact companies filename
	const companiesByKey = new Map<string, string>();
	for (const f of listPng(COMPANIES_DIR)) {
		companiesByKey.set(looseKey(f), f);
	}

	const logos = listPng(LOGOTYPES_DIR);

	const planned = new Map<string, string[]>(); // target -> sources
	const renames: Array<{ from: string; to: string; matched: boolean }> = [];
	let unchanged = 0;

	for (const from of logos) {
		const key = looseKey(from);
		const matchedName = companiesByKey.get(key);
		const to = matchedName ?? slugify(from);

		(planned.get(to) ?? planned.set(to, []).get(to)!).push(from);

		if (to !== from) {
			renames.push({ from, to, matched: Boolean(matchedName) });
		} else {
			unchanged++;
		}
	}

	const collisions = [...planned.entries()].filter(
		([, srcs]) => srcs.length > 1,
	);
	if (collisions.length) {
		console.log("!! COLLISIONS (multiple logotypes map to the same name):");
		for (const [to, srcs] of collisions)
			console.log(`   ${to}  <=  ${srcs.join(", ")}`);
		console.log("");
	}

	const matchedRenames = renames.filter((r) => r.matched);
	console.log("== Renames matched to a companies/ name (char-for-char) ==");
	for (const r of matchedRenames) console.log(`  ${r.from}  ->  ${r.to}`);
	if (!matchedRenames.length) console.log("  (none)");

	console.log("");
	console.log(`Total logotypes : ${logos.length}`);
	console.log(`Matched renames : ${matchedRenames.length}`);
	console.log(`Slug renames    : ${renames.length - matchedRenames.length}`);
	console.log(`Unchanged       : ${unchanged}`);
	console.log(`Collisions      : ${collisions.length}`);

	if (!apply) {
		console.log("\nDry run. Re-run with --apply to perform the renames.");
		return;
	}
	if (collisions.length) {
		console.error("\nAborting: resolve collisions before applying.");
		process.exit(1);
	}

	for (const r of renames) renameFile(LOGOTYPES_DIR, r.from, r.to);
	console.log(`\nDone. Renamed ${renames.length} files.`);
}

main();
