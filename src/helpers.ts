import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const TypeSub = new yaml.Type('!Sub', {
  kind: 'scalar',
  construct: function (data) {
    return data;
  },
  represent: function (data) {
    return `!Sub ${data}`;
  },
});

const TypeRef = new yaml.Type('!Ref', {
  kind: 'scalar',
  construct: function (data) {
    return data;
  },
  represent: function (data) {
    return `!Ref ${data}`;
  },
});
const CUSTOM_SCHEMA = yaml.DEFAULT_SCHEMA.extend([TypeSub, TypeRef]);

function updateYamlFile(filePath: string, updater: (doc: any) => void): void {
  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(fileContent, { schema: CUSTOM_SCHEMA });

    updater(doc);

    fs.writeFileSync(
      filePath,
      yaml.dump(doc, {
        schema: CUSTOM_SCHEMA,
        lineWidth: -1,
        noCompatMode: true,
      })
    );
  }
}

export function updateNpmrc(
  packageJsonPath: string,
  packageJson: any,
  repoPath: string
) {
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n'
  );

  const npmrcPath = path.join(repoPath, '.npmrc');
  let npmrcContent = fs.existsSync(npmrcPath)
    ? fs.readFileSync(npmrcPath, 'utf8')
    : '';

  npmrcContent = npmrcContent.replace(/engine-strict=true\s*\n?/, '');

  if (!npmrcContent.includes('engine-strict=false')) {
    npmrcContent += fs.writeFileSync(
      npmrcPath,
      npmrcContent + '\nengine-strict=false\n'
    );
  }
}

export async function createPullRequest(
  octokit: Octokit,
  repo: any,
  branchName: string,
  defaultBranch: string,
  repoPath: string
) {
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
  } catch (error) {
    console.error(`Failed to create PR for ${repo.name}:`, error);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function updateServerlessFile(repoPath: string) {
  const serverlessPath = path.join(repoPath, 'serverless.yml');
  updateYamlFile(serverlessPath, (doc) => {
    if (doc.provider && doc.provider.runtime === 'nodejs16.x') {
      doc.provider.runtime = 'nodejs18.x';
    }
  });
}

export function updateBuildSpec(repoPath: string) {
  const buildSpecRegex = /^buildspec\.(pr|ci|deploy)\.yml$/;
  const files = fs.readdirSync(repoPath);

  for (const file of files) {
    if (buildSpecRegex.test(file)) {
      const buildspectPath = path.join(repoPath, file);
      updateYamlFile(buildspectPath, (doc) => {
        if (
          doc.phases &&
          doc.phases.install &&
          doc.phases.install['runtime-versions']
        ) {
          const runtimeVersions = doc.phases.install['runtime-versions'];
          if (runtimeVersions.nodejs && parseInt(runtimeVersions.nodejs) < 18) {
            runtimeVersions.nodejs = '18';
          }
        }
      });
    }
  }
}

export function updateNodePackageVersion(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number);

  return `${major + 1}.0.0`;
}
