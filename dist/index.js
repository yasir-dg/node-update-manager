"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const rest_1 = require("@octokit/rest");
const simple_git_1 = __importDefault(require("simple-git"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const os_1 = __importDefault(require("os"));
dotenv_1.default.config();
const GITHUB_TOKEN = process.env.OCTOKIT_AUTH;
const octokit = new rest_1.Octokit({
    auth: `token ${GITHUB_TOKEN}`,
});
const execPromise = util_1.default.promisify(child_process_1.exec);
async function findRepos() {
    try {
        const { data } = await octokit.search.repos({
            q: 'dgx-common-basket-service in:name',
            sort: 'updated',
            order: 'desc',
        });
        return data.items;
    }
    catch (error) {
        console.error('Failed to fetch repositories:', error);
        return [];
    }
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function updateRepository(repo) {
    const repoPath = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'repo-'));
    const gitClient = (0, simple_git_1.default)();
    const repoUrl = `git@github.com:/${repo.full_name}.git`;
    try {
        await gitClient.clone(repoUrl, repoPath);
    }
    catch (error) {
        console.error(`Failed to clone repository ${repoUrl}:`, error);
        fs_1.default.rmSync(repoPath, { recursive: true, force: true });
        return;
    }
    const packageJsonPath = path_1.default.join(repoPath, 'package.json');
    const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.engines === undefined || packageJson.engines === null) {
        return;
    }
    delete packageJson.engines;
    fs_1.default.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    const npmrcPath = path_1.default.join(repoPath, '.npmrc');
    let npmrcContent = fs_1.default.existsSync(npmrcPath)
        ? fs_1.default.readFileSync(npmrcPath, 'utf8')
        : '';
    npmrcContent = npmrcContent.replace(/engine-strict=true\s*\n?/, '');
    if (!npmrcContent.includes('engine-strict=false')) {
        npmrcContent += fs_1.default.writeFileSync(npmrcPath, npmrcContent + '\nengine-strict=false\n');
    }
    fs_1.default.writeFileSync(path_1.default.join(repoPath, '.nvmrc'), '18\n');
    try {
        const { stdout, stderr } = await execPromise('npm install', {
            cwd: repoPath,
        });
        console.log(stdout);
        if (stderr) {
            console.error('npm install errors:', stderr);
        }
    }
    catch (error) {
        console.error('Failed to run npm install:', error);
        return;
    }
    const branchName = 'update-node-versions';
    await gitClient.cwd(repoPath).checkoutLocalBranch(branchName);
    await gitClient.add('./*');
    await gitClient.commit('Update package configurations including package-lock.json');
    await gitClient.push('origin', branchName);
    const defaultBranch = (await gitClient.branch()).current;
    try {
        const { data: pr } = await octokit.pulls.create({
            owner: repo.owner.login,
            repo: repo.name,
            title: 'Update Node version',
            head: branchName,
            base: defaultBranch,
            body: 'This PR updates package.json, .npmrc, .nvmrc and package-lock.json to node 18',
        });
        console.log(`Created PR: ${pr.html_url}`);
    }
    catch (error) {
        console.error(`Failed to create PR for ${repo.name}:`, error);
    }
    finally {
        fs_1.default.rmSync(repoPath, { recursive: true, force: true });
    }
}
async function processUpdate() {
    const repos = await findRepos();
    for (const repo of repos) {
        await updateRepository(repo);
        await delay(5000);
    }
}
processUpdate();
