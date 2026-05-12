/**
 * Checks which shared module files have diverged between express-boilerplate and next-boilerplate.
 * Framework-specific files (router.ts, route.ts, ui/, dictionaries/, *.test.ts) are skipped.
 * Run: npx ts-node scripts/sync-check.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const EXPRESS_MODULES = path.resolve(__dirname, "../modules");
const NEXT_MODULES = path.resolve(__dirname, "../../next-boilerplate/modules");

// Files/dirs that are expected to differ between frameworks
const SKIP_PATTERNS = [
    /^router(\/|\.ts$)/,
    /^middleware(\/|\.ts$)/,
    /^ui(\/|$)/,
    /^dictionaries(\/|$)/,
    /\.test\.ts$/,
    /README\.md$/,
    /auth\.types\.ts$/,  // may have framework-specific session types
];

function shouldSkip(relativePath: string): boolean {
    return SKIP_PATTERNS.some((re) => re.test(relativePath));
}

function hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex");
}

function collectFiles(dir: string): Map<string, string> {
    const result = new Map<string, string>();
    if (!fs.existsSync(dir)) return result;

    function walk(current: string, prefix: string) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (shouldSkip(rel)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full, rel);
            } else {
                result.set(rel, hashFile(full));
            }
        }
    }

    walk(dir, "");
    return result;
}

const RESET  = "\x1b[0m";
const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";

function main() {
    const expressModules = fs.readdirSync(EXPRESS_MODULES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    const nextModules = new Set(
        fs.readdirSync(NEXT_MODULES, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
    );

    let diffCount  = 0;
    let syncCount  = 0;
    let onlyInExpr = 0;
    let onlyInNext = 0;

    const onlyInNextList: string[] = [];

    for (const mod of expressModules) {
        if (!nextModules.has(mod)) {
            console.log(`${YELLOW}⚠  ${mod.padEnd(30)}${RESET} only in express`);
            onlyInExpr++;
            continue;
        }
        nextModules.delete(mod);

        const exprFiles = collectFiles(path.join(EXPRESS_MODULES, mod));
        const nextFiles = collectFiles(path.join(NEXT_MODULES, mod));

        const allKeys = new Set([...exprFiles.keys(), ...nextFiles.keys()]);
        const diffs: string[] = [];

        for (const file of allKeys) {
            const inExpr = exprFiles.get(file);
            const inNext = nextFiles.get(file);
            if (!inExpr) {
                diffs.push(`  ${YELLOW}+ ${file}${RESET} (only in next)`);
            } else if (!inNext) {
                diffs.push(`  ${YELLOW}- ${file}${RESET} (only in express)`);
            } else if (inExpr !== inNext) {
                diffs.push(`  ${RED}≠ ${file}${RESET}`);
            }
        }

        if (diffs.length === 0) {
            console.log(`${GREEN}✓  ${mod.padEnd(30)}${RESET} in sync`);
            syncCount++;
        } else {
            console.log(`${RED}✗  ${BOLD}${mod.padEnd(30)}${RESET}${RED} ${diffs.length} file(s) differ${RESET}`);
            diffs.forEach((d) => console.log(d));
            diffCount++;
        }
    }

    for (const mod of nextModules) {
        if (mod === "ui") continue; // Next.js-only by design
        console.log(`${YELLOW}⚠  ${mod.padEnd(30)}${RESET} only in next`);
        onlyInNextList.push(mod);
        onlyInNext++;
    }

    console.log("\n" + "─".repeat(50));
    console.log(`${GREEN}✓ ${syncCount} in sync${RESET}   ${RED}✗ ${diffCount} differ${RESET}   ${YELLOW}⚠ ${onlyInExpr + onlyInNext} only in one${RESET}`);
    if (diffCount > 0) process.exit(1);
}

main();
