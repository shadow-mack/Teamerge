export function branchName(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

/** Display form of a local or remote ref: `refs/remotes/origin/main` reads as `origin/main`. */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|remotes)\//, '')
}
