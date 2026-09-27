// The CLA check that .github/workflows/cla.yml runs on pull requests. Whoever opens a pull request, and
// the author of every commit in it, accepts CLA.md once by commenting SIGN_PHRASE. This records who did in
// signatures.json on the cla-signatures branch, keeps one comment on the pull request up to date, and sets
// the "CLA" status on the pull request's last commit.
//
// It runs with a token that can write, also for pull requests from forks, so it only reads pull requests
// through the API: never check out, build or run a pull request's code here.

/** Raise it when CLA.md changes in substance: everyone then signs the new version once. */
const CLA_VERSION = 1;
const SIGN_PHRASE = "I have read the CLA Document and I hereby sign the CLA";
const BRANCH = "cla-signatures";
const FILE = "signatures.json";
const MARKER = "<!-- pacedmind-cla -->";

/** A comment as the check compares it: case, spacing and a closing period don't matter. */
const normalize = (text) => String(text ?? "").trim().replace(/[.!]+$/, "").replace(/\s+/g, " ").toLowerCase();
const isBot = (user) => user.type === "Bot" || user.login.endsWith("[bot]");
/** Names from commit metadata are anyone's text: shown as code, they can't mention, link or format. */
const code = (text) => "`" + String(text).replace(/[`\r\n]/g, "'").slice(0, 60) + "`";

module.exports = async function cla({ github, context, core }) {
  const { owner, repo } = context.repo;
  const issue = context.payload.issue;
  if (context.eventName === "issue_comment" && !issue?.pull_request) return;
  const number = context.payload.pull_request?.number ?? issue?.number;
  if (!number) return;
  const claUrl = `https://github.com/${owner}/${repo}/blob/${context.payload.repository.default_branch}/CLA.md`;

  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  const commits = await github.paginate(github.rest.pulls.listCommits, { owner, repo, pull_number: number, per_page: 100 });

  // Who has to sign: whoever opened the pull request and every commit's author, except the repository's
  // owner and bots.
  const people = new Map(); // GitHub user id -> login
  const unlinked = new Set(); // commit authors whose email belongs to no GitHub account
  const include = (user) => {
    if (user && !isBot(user) && user.login !== owner) people.set(user.id, user.login);
  };
  include(pr.user);
  for (const commit of commits) {
    if (commit.author) include(commit.author);
    else unlinked.add(commit.commit.author?.name || commit.sha.slice(0, 7));
  }

  let { signatures } = await load();
  const signed = (id) => signatures.some((s) => s.id === id && s.cla === CLA_VERSION);

  // A signature: the sign phrase, commented by someone who has to sign.
  const comment = context.payload.comment;
  if (comment && normalize(comment.body) === normalize(SIGN_PHRASE) && people.has(comment.user.id) && !signed(comment.user.id)) {
    await save({
      login: comment.user.login,
      id: comment.user.id,
      cla: CLA_VERSION,
      signedAt: comment.created_at,
      pullRequest: number,
      comment: comment.html_url,
    });
  }

  const missing = [...people].filter(([id]) => !signed(id)).map(([, login]) => login);
  const ok = missing.length === 0 && unlinked.size === 0;
  const waiting = [...missing, ...unlinked].join(", ");

  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: pr.head.sha,
    context: "CLA",
    state: ok ? "success" : "failure",
    target_url: claUrl,
    description: (ok ? "Everyone in this pull request has signed the CLA" : `Not signed yet: ${waiting}`).slice(0, 140),
  });

  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 });
  const previous = comments.find((c) => c.user && isBot(c.user) && c.body?.startsWith(MARKER));
  const body = ok
    ? `${MARKER}\nEveryone in this pull request has signed the [Contributor License Agreement](${claUrl}). Thank you.`
    : [
        MARKER,
        `Thank you for your pull request. Before it can be merged, everyone whose commits are in it accepts PacedMind's [Contributor License Agreement](${claUrl}), once. To accept it, comment:`,
        "",
        `> ${SIGN_PHRASE}`,
        "",
        ...(missing.length ? [`Not signed yet: ${missing.map((login) => `@${login}`).join(", ")}.`] : []),
        ...(unlinked.size
          ? [`Commits by ${[...unlinked].map(code).join(", ")} aren't linked to a GitHub account: add their email to that account (**Settings → Emails**), or change the commits' author, and push them again.`]
          : []),
        "",
        "Comment `recheck` to check again.",
      ].join("\n");
  if (previous) {
    if (previous.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: previous.id, body });
  } else if (!ok) {
    await github.rest.issues.createComment({ owner, repo, issue_number: number, body });
  }
  core.info(ok ? "Everyone in this pull request has signed the CLA." : `Not signed yet: ${waiting}`);

  /** The signatures so far, and the file's blob sha (null while there's no file). */
  async function load() {
    try {
      const { data } = await github.rest.repos.getContent({ owner, repo, path: FILE, ref: BRANCH });
      const list = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      if (!Array.isArray(list)) throw new Error(`${FILE} on ${BRANCH} isn't a list.`);
      return { signatures: list, sha: data.sha };
    } catch (error) {
      if (error.status === 404) return { signatures: [], sha: null };
      throw error;
    }
  }

  /** Adds a signature to the file. Another run may write it at the same moment: then read it again. */
  async function save(signature) {
    for (let attempt = 1; ; attempt++) {
      const current = await load();
      signatures = current.signatures;
      if (signed(signature.id)) return;
      const next = [...current.signatures, signature];
      const content = Buffer.from(JSON.stringify(next, null, 2) + "\n").toString("base64");
      const message = `CLA version ${CLA_VERSION} signed by ${signature.login} in #${number}`;
      try {
        if (current.sha === null && !(await branchExists())) await createBranch(content, message);
        else await github.rest.repos.createOrUpdateFileContents({ owner, repo, branch: BRANCH, path: FILE, message, content, ...(current.sha ? { sha: current.sha } : {}) });
        signatures = next;
        return;
      } catch (error) {
        if (attempt < 3 && (error.status === 409 || error.status === 422)) continue;
        throw error;
      }
    }
  }

  async function branchExists() {
    try {
      await github.rest.repos.getBranch({ owner, repo, branch: BRANCH });
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  /** The branch holds only the signatures, with a history of its own. */
  async function createBranch(content, message) {
    const { data: blob } = await github.rest.git.createBlob({ owner, repo, content, encoding: "base64" });
    const { data: tree } = await github.rest.git.createTree({ owner, repo, tree: [{ path: FILE, mode: "100644", type: "blob", sha: blob.sha }] });
    const { data: commit } = await github.rest.git.createCommit({ owner, repo, message, tree: tree.sha, parents: [] });
    await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  }
};
