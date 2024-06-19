import { Octokit } from '@octokit/rest';
import simpleGit, { SimpleGit } from 'simple-git';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import os from 'os';
import {
  createPullRequest,
  delay,
  updateNodePackageVersion,
  updateNpmrc,
} from './helpers';

dotenv.config();

const GITHUB_TOKEN = process.env.OCTOKIT_AUTH;

const octokit = new Octokit({
  auth: `token ${GITHUB_TOKEN}`,
});

const execPromise = util.promisify(exec);

async function findRepos(): Promise<any[]> {
  try {
    const { data } = await octokit.search.repos({
      //ensures repositories that contain dgx-common libraries are returned but not services.
      q: 'dgx-common in:name ',
      sort: 'updated',
      order: 'desc',
    });

    const filteredRepos = data.items.filter(repo => !repo.name.includes('service'))

    return filteredRepos;
  } catch (error) {
    console.error('Failed to fetch repositories:', error);
    return [];
  }
}

async function updateRepository(repo: any): Promise<void> {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  const gitClient: SimpleGit = simpleGit();
  const repoUrl = `git@github.com:/${repo.full_name}.git`;

  try {
    await gitClient.clone(repoUrl, repoPath);
  } catch (error) {
    console.error(`Failed to clone repository ${repoUrl}:`, error);
    fs.rmSync(repoPath, { recursive: true, force: true });
    return;
  }

  const packageJsonPath = path.join(repoPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  if (packageJson.engines === undefined || packageJson.engines === null) {
    return;
  }

  delete packageJson.engines;

  packageJson.version = updateNodePackageVersion(packageJson.version)

  updateNpmrc(packageJsonPath, packageJson, repoPath);

  fs.writeFileSync(path.join(repoPath, '.nvmrc'), '18\n');

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

  const { data: repoDetails } = await octokit.repos.get({
    owner: repo.owner.login,
    repo: repo.name
  });

  const defaultBranch = repoDetails.default_branch

  const branchName = 'remove-node-engines';
  await gitClient.cwd(repoPath).checkoutLocalBranch(branchName);
  await gitClient.add('./*');
  await gitClient.commit(
    'Update package configurations including package-lock.json'
  );
  await gitClient.push('origin', branchName);

  await createPullRequest(octokit, repo, branchName, defaultBranch, repoPath);
}

async function processUpdate() {
  const repos = await findRepos();

  for (const repo of repos) {
    await updateRepository(repo);
    await delay(5000);
  }
}

processUpdate();
