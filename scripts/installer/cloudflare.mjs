import { CommandError, runCommand, safeChildEnvironment } from "./runner.mjs";

export function wranglerEnvironment(token, accountId, outputFile) {
  return safeChildEnvironment(process.env, {
    ...(token ? { CLOUDFLARE_API_TOKEN: token } : {}),
    ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
    ...(outputFile ? { WRANGLER_OUTPUT_FILE_PATH: outputFile } : {}),
  });
}

export function parseWhoami(source) {
  const parsed = JSON.parse(source);
  const accounts = Array.isArray(parsed.accounts)
    ? parsed.accounts.map((account) => ({
        id: account.id ?? account.accountId,
        name: account.name ?? account.accountName,
      }))
    : [];
  if (
    accounts.some(
      (account) =>
        typeof account.id !== "string" || typeof account.name !== "string",
    )
  )
    throw new Error("Wrangler returned an invalid account list.");
  return accounts;
}

export function authenticateWrangler({ checkout, token, run = runCommand }) {
  const result = run("wrangler", ["whoami", "--json"], {
    cwd: checkout,
    env: wranglerEnvironment(token),
    label: "Cloudflare authentication",
  });
  const accounts = parseWhoami(result.stdout);
  if (accounts.length === 0)
    throw new Error(
      "Cloudflare authentication returned no accessible accounts.",
    );
  return accounts;
}

export function listCloudflareResources({
  checkout,
  token,
  accountId,
  worker,
  run = runCommand,
}) {
  const env = wranglerEnvironment(token, accountId);
  const databases = JSON.parse(
    run("wrangler", ["d1", "list", "--json"], {
      cwd: checkout,
      env,
      label: "D1 collision check",
    }).stdout,
  );
  const buckets = run("wrangler", ["r2", "bucket", "list"], {
    cwd: checkout,
    env,
    label: "R2 collision check",
  }).stdout;
  const inspectedWorker = inspectWorker({
    checkout,
    token,
    accountId,
    worker,
    run,
  });
  return {
    databases,
    buckets,
    workerExists: inspectedWorker.exists,
    workerDeployments: inspectedWorker.deployments,
  };
}

export function assertNoCollisions(listed, names) {
  if (listed.databases.some((database) => database.name === names.database))
    throw new Error(
      `D1 resource ${names.database} already exists and will not be adopted.`,
    );
  const escapedBucket = names.bucket.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (
    new RegExp(`(?:^|\\s)${escapedBucket}(?:\\s|$)`, "mu").test(listed.buckets)
  )
    throw new Error(
      `R2 resource ${names.bucket} already exists and will not be adopted.`,
    );
  if (
    listed.workerExists === true ||
    (Array.isArray(listed.workerDeployments) &&
      listed.workerDeployments.length > 0)
  )
    throw new Error(
      `Worker ${names.worker} already exists and will not be overwritten.`,
    );
}

function isMissing(error) {
  return (
    error instanceof CommandError &&
    /not found|not_found|script_not_found|couldn't find|no such|404|10090/iu.test(
      error.stderr,
    )
  );
}

function parseJsonObject(source, label) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} returned malformed JSON.`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} returned an invalid object.`);
  return parsed;
}

export function inspectD1({
  checkout,
  token,
  accountId,
  database,
  run = runCommand,
}) {
  try {
    const result = run("wrangler", ["d1", "info", database, "--json"], {
      cwd: checkout,
      env: wranglerEnvironment(token, accountId),
      label: "D1 ownership lookup",
    });
    const parsed = parseJsonObject(result.stdout, "D1 ownership lookup");
    if (typeof parsed.name !== "string" || typeof parsed.uuid !== "string")
      throw new Error("D1 ownership lookup returned no exact name and UUID.");
    return { exists: true, name: parsed.name, id: parsed.uuid.toLowerCase() };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

export function inspectR2({
  checkout,
  token,
  accountId,
  bucket,
  run = runCommand,
}) {
  try {
    const result = run("wrangler", ["r2", "bucket", "info", bucket, "--json"], {
      cwd: checkout,
      env: wranglerEnvironment(token, accountId),
      label: "R2 ownership lookup",
    });
    const parsed = parseJsonObject(result.stdout, "R2 ownership lookup");
    if (typeof parsed.name !== "string")
      throw new Error("R2 ownership lookup returned no exact bucket name.");
    return { exists: true, name: parsed.name };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

function parseDeployments(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Worker ownership lookup returned malformed JSON.", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed))
    throw new Error(
      "Worker ownership lookup returned an invalid deployment list.",
    );
  for (const deployment of parsed) {
    if (
      !deployment ||
      typeof deployment !== "object" ||
      typeof deployment.id !== "string" ||
      !Array.isArray(deployment.versions) ||
      deployment.versions.length === 0 ||
      deployment.versions.some(
        (version) =>
          !version ||
          typeof version !== "object" ||
          typeof version.version_id !== "string",
      )
    )
      throw new Error(
        "Worker ownership lookup returned an invalid deployment record.",
      );
  }
  return parsed;
}

export function inspectWorker({
  checkout,
  token,
  accountId,
  worker,
  run = runCommand,
}) {
  try {
    const result = run(
      "wrangler",
      ["deployments", "list", "--name", worker, "--json"],
      {
        cwd: checkout,
        env: wranglerEnvironment(token, accountId),
        label: "Worker ownership lookup",
      },
    );
    return { exists: true, deployments: parseDeployments(result.stdout) };
  } catch (error) {
    if (isMissing(error)) return { exists: false, deployments: [] };
    throw error;
  }
}

async function cloudflareResult(fetchImpl, token, pathname) {
  if (!token)
    throw new Error(
      "Worker URL ownership verification requires a Cloudflare API token; rerun with a token file or CLOUDFLARE_API_TOKEN.",
    );
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4${pathname}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(
      `Cloudflare ownership lookup failed with HTTP ${response.status}.`,
    );
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("Cloudflare ownership lookup returned malformed JSON.", {
      cause: error,
    });
  }
  if (body?.success !== true || !body.result)
    throw new Error("Cloudflare ownership lookup returned no verified result.");
  return body.result;
}

export async function verifiedWorkerUrl({
  accountId,
  worker,
  token,
  fetchImpl,
}) {
  const encodedAccount = encodeURIComponent(accountId);
  const encodedWorker = encodeURIComponent(worker);
  const account = await cloudflareResult(
    fetchImpl,
    token,
    `/accounts/${encodedAccount}/workers/subdomain`,
  );
  const script = await cloudflareResult(
    fetchImpl,
    token,
    `/accounts/${encodedAccount}/workers/scripts/${encodedWorker}/subdomain`,
  );
  if (
    typeof account.subdomain !== "string" ||
    !/^[a-z0-9-]+$/u.test(account.subdomain) ||
    script.enabled !== true
  )
    throw new Error(
      "Cloudflare ownership lookup returned no enabled workers.dev identity.",
    );
  return new URL(
    `https://${worker}.${account.subdomain}.workers.dev/`,
  ).toString();
}

export function parseCreatedDatabaseId(output) {
  const matches =
    output.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
    ) ?? [];
  const unique = [...new Set(matches.map((value) => value.toLowerCase()))];
  if (unique.length !== 1)
    throw new Error("D1 creation returned no unambiguous database UUID.");
  return unique[0];
}
