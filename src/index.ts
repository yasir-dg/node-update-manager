import { Octokit } from '@octokit/rest';
import simpleGit, { SimpleGit } from 'simple-git';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const GITHUB_TOKEN = process.env.OCTOKIT_AUTH;

const octokit = new Octokit({
  auth: `token ${GITHUB_TOKEN}`,
});

const execPromise = util.promisify(exec);

async function findRepos(): Promise<any[]> {
  try {
    const { data } = await octokit.search.repos({
      q: 'dgx-common in:name',
      sort: 'updated',
      order: 'desc',
    });

    return data.items;
  } catch (error) {
    console.error('Failed to fetch repositories:', error);
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateRepository(repo: any): Promise<void> {
  const repoPath = path.join(__dirname, '..', 'repos', repo.name);
  const gitClient: SimpleGit = simpleGit();
  const repoUrl = `git@github.com:/${repo.full_name}.git`;

  if (!fs.existsSync(repoPath)) {
    fs.mkdirSync(repoPath, { recursive: true });
  }

  try {
    await gitClient.clone(repoUrl, repoPath);
  } catch (error) {
    console.error(`Failed to clone repository ${repoUrl}:`, error);
    return;
  }

  const packageJsonPath = path.join(repoPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  if (packageJson.engines === undefined || packageJson.engines === null) {
    return;
  }

  delete packageJson.engines;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  const npmrcPath = path.join(repoPath, '.npmrc');
  const npmrcContent = fs.existsSync(npmrcPath)
    ? fs.readFileSync(npmrcPath, 'utf8')
    : '';
  fs.writeFileSync(npmrcPath, npmrcContent + '\nengine-strict=false\n');

  fs.writeFileSync(path.join(repoPath, '.nvmrc'), '18');

  try {
    const { stdout, stderr } = await execPromise('npm install', {
      cwd: repoPath,
    });
    console.log(stdout);
    if (stderr) {
      console.error('npm install errors:', stderr);
    }
  } catch (error) {
    console.error('Failed to run npm install:', error);
    return;
  }

  const branchName = 'update-node-versions';
  await gitClient.cwd(repoPath).checkoutLocalBranch(branchName);
  await gitClient.add('./*');
  await gitClient.commit(
    'Update package configurations including package-lock.json'
  );
  await gitClient.push('origin', branchName);

  let defaultBranch = 'main';
  try {
    const { data: repoDetails } = await octokit.repos.get({
      owner: repo.owner.login,
      repo: repo.name,
    });
    defaultBranch = repoDetails.default_branch;
  } catch (error) {
    console.error(`Failed to get repository details for ${repo.name}:`, error);
  }

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

async function processUpdate() {
  const repos = await findRepos();

  for (const repo of repos) {
    await updateRepository(repo);
    await delay(5000);
  }
}

processUpdate();
