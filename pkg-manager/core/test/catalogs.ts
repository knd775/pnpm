import { createPeersDirSuffix } from '@pnpm/dependency-path'
import { type ProjectId, type ProjectManifest } from '@pnpm/types'
import { prepareEmpty } from '@pnpm/prepare'
import { type MutatedProject, mutateModules, type ProjectOptions } from '@pnpm/core'
import { arrayOfWorkspacePackagesToMap } from '@pnpm/workspace.find-packages'
import path from 'path'
import { testDefaults } from './utils'

function preparePackagesAndReturnObjects (manifests: Array<ProjectManifest & Required<Pick<ProjectManifest, 'name'>>>) {
  const project = prepareEmpty()
  const projects: Record<ProjectId, ProjectManifest> = {}
  for (const manifest of manifests) {
    projects[manifest.name as ProjectId] = manifest
  }
  const allProjects: ProjectOptions[] = Object.entries(projects)
    .map(([id, manifest]) => ({
      buildIndex: 0,
      manifest,
      dir: path.resolve(id),
      rootDir: path.resolve(id),
    }))
  return {
    ...project,
    projects,
    options: testDefaults({
      allProjects,
      workspacePackages: arrayOfWorkspacePackagesToMap(allProjects),
    }),
  }
}

function installProjects (projects: Record<ProjectId, ProjectManifest>): MutatedProject[] {
  return Object.entries(projects)
    .map(([id, manifest]) => ({
      mutation: 'install',
      id,
      manifest,
      rootDir: path.resolve(id),
    }))
}

test('installing with "catalog:" should work', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        'is-positive': 'catalog:',
      },
    },
    // Empty second project to create a multi-package workspace.
    {
      name: 'project2',
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: { 'is-positive': '1.0.0' },
    },
  })

  const lockfile = readLockfile()
  expect(lockfile.importers['project1' as ProjectId]).toEqual({
    dependencies: {
      'is-positive': {
        specifier: 'catalog:',
        version: '1.0.0',
      },
    },
  })
})

test('importer to importer dependency with "catalog:" should work', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        project2: 'workspace:*',
      },
    },
    {
      name: 'project2',
      dependencies: {
        'is-positive': 'catalog:',
      },
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: { 'is-positive': '1.0.0' },
    },
  })

  const lockfile = readLockfile()
  expect(lockfile.importers['project2' as ProjectId]).toEqual({
    dependencies: {
      'is-positive': {
        specifier: 'catalog:',
        version: '1.0.0',
      },
    },
  })
})

test('importer with different peers uses correct peer', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        '@pnpm.e2e/has-foo100-peer': 'catalog:',
        // Define a peer with an exact version to ensure the dep above uses
        // this peer.
        '@pnpm.e2e/foo': '100.0.0',
      },
    },
    {
      name: 'project2',
      dependencies: {
        '@pnpm.e2e/has-foo100-peer': 'catalog:',
        // Note that this peer is intentionally different than the one above
        // for project 1. (100.1.0 instead of 100.0.0).
        //
        // We want to ensure project2 resolves to the same catalog version for
        // @pnpm.e2e/has-foo100-peer, but uses a different peers suffix.
        //
        // Catalogs allow versions to be reused, but this test ensures we
        // don't reuse versions too aggressively.
        '@pnpm.e2e/foo': '100.1.0',
      },
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        '@pnpm.e2e/has-foo100-peer': '^1.0.0',
      },
    },
  })

  const lockfile = readLockfile()
  expect(lockfile.importers['project1' as ProjectId]?.dependencies?.['@pnpm.e2e/has-foo100-peer']).toEqual({
    specifier: 'catalog:',
    version: `1.0.0${createPeersDirSuffix([{ name: '@pnpm.e2e/foo', version: '100.0.0' }])}`,
  })
  expect(lockfile.importers['project2' as ProjectId]?.dependencies?.['@pnpm.e2e/has-foo100-peer']).toEqual({
    specifier: 'catalog:',
    //              This version is intentionally different from the one above    ꜜ
    version: `1.0.0${createPeersDirSuffix([{ name: '@pnpm.e2e/foo', version: '100.1.0' }])}`,
  })
})

test('lockfile contains catalog snapshots', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        'is-positive': 'catalog:',
      },
    },
    {
      name: 'project2',
      dependencies: {
        'is-negative': 'catalog:',
      },
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        'is-positive': '^1.0.0',
        'is-negative': '^1.0.0',
      },
    },
  })

  const lockfile = readLockfile()
  expect(lockfile.catalogs).toStrictEqual({
    default: {
      'is-positive': { specifier: '^1.0.0', version: '1.0.0' },
      'is-negative': { specifier: '^1.0.0', version: '1.0.0' },
    },
  })
})

test('lockfile is updated if catalog config changes', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        'is-positive': 'catalog:',
      },
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        'is-positive': '=1.0.0',
      },
    },
  })

  expect(readLockfile().importers['project1' as ProjectId]).toEqual({
    dependencies: {
      'is-positive': {
        specifier: 'catalog:',
        version: '1.0.0',
      },
    },
  })

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        'is-positive': '=3.1.0',
      },
    },
  })

  expect(readLockfile().importers['project1' as ProjectId]).toEqual({
    dependencies: {
      'is-positive': {
        specifier: 'catalog:',
        version: '3.1.0',
      },
    },
  })
})

test('lockfile catalog snapshots retain existing entries on --filter', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        'is-negative': 'catalog:',
      },
    },
    {
      name: 'project2',
      dependencies: {
        'is-positive': 'catalog:',
      },
    },
  ])

  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        'is-positive': '^1.0.0',
        'is-negative': '^1.0.0',
      },
    },
  })

  expect(readLockfile().catalogs).toStrictEqual({
    default: {
      'is-negative': { specifier: '^1.0.0', version: '1.0.0' },
      'is-positive': { specifier: '^1.0.0', version: '1.0.0' },
    },
  })

  // Update catalog definitions so pnpm triggers a rerun.
  await mutateModules(installProjects(projects).slice(1), {
    ...options,
    lockfileOnly: true,
    catalogs: {
      default: {
        'is-positive': '=3.1.0',
        'is-negative': '^1.0.0',
      },
    },
  })

  expect(readLockfile().catalogs).toStrictEqual({
    default: {
      // The is-negative snapshot should be carried from the previous install,
      // despite the current filtered install not using it.
      'is-negative': { specifier: '^1.0.0', version: '1.0.0' },

      'is-positive': { specifier: '=3.1.0', version: '3.1.0' },
    },
  })
})

// If a catalog specifier was used in one or more package.json files and all
// usages were removed later, we should remove the catalog snapshot from
// pnpm-lock.yaml. This should happen even if the dependency is still defined in
// a catalog under pnpm-workspace.yaml.
//
// Note that this behavior may not be desirable in all cases. If someone removes
// the last usage of a catalog entry, and another person adds it back later,
// that dependency will be re-resolved to a newer version. This is probably
// desirable most of the time, but there could be a good argument to cache the
// older unused resolution. For now we'll remove the unused entries since that's
// what would happen anyway if catalogs aren't used.
test('lockfile catalog snapshots should remove unused entries', async () => {
  const { options, projects, readLockfile } = preparePackagesAndReturnObjects([
    {
      name: 'project1',
      dependencies: {
        'is-negative': 'catalog:',
        'is-positive': 'catalog:',
      },
    },
  ])

  const catalogs = {
    default: {
      'is-negative': '=1.0.0',
      'is-positive': '=1.0.0',
    },
  }
  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs,
  })

  {
    const lockfile = readLockfile()
    expect(lockfile.importers['project1' as ProjectId]?.dependencies).toEqual({
      'is-negative': { specifier: 'catalog:', version: '1.0.0' },
      'is-positive': { specifier: 'catalog:', version: '1.0.0' },
    })
    expect(lockfile.catalogs?.default).toStrictEqual({
      'is-negative': { specifier: '=1.0.0', version: '1.0.0' },
      'is-positive': { specifier: '=1.0.0', version: '1.0.0' },
    })
  }

  // Update package.json to no longer depend on is-positive.
  projects['project1' as ProjectId].dependencies = {
    'is-negative': 'catalog:',
  }
  await mutateModules(installProjects(projects), {
    ...options,
    lockfileOnly: true,
    catalogs,
  })

  {
    const lockfile = readLockfile()
    expect(lockfile.importers['project1' as ProjectId]?.dependencies).toEqual({
      'is-negative': { specifier: 'catalog:', version: '1.0.0' },
    })
    // Only "is-negative" should be in the catalogs section of the lockfile
    // since all packages in the workspace no longer use is-positive. Note that
    // this should be the case even if pnpm-workspace.yaml still has
    // "is-positive" configured.
    expect(lockfile.catalogs?.default).toStrictEqual({
      'is-negative': { specifier: '=1.0.0', version: '1.0.0' },
    })
  }
})
