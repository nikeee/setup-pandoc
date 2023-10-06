import * as path from "path";
import cp from "child_process";

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { HttpClient } from "@actions/http-client";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import { compare } from "compare-versions";

const PERMANENT_FALLBACK_VERSION = "2.17.1.1";

type Platform = "windows" | "mac" | "linux";

const platform: Platform =
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
    ? "mac"
    : "linux";

function getBaseLocation(platform: Platform) {
  switch (platform) {
    case "windows":
      // On windows, use the USERPROFILE env variable
      return process.env["USERPROFILE"] ?? "C:\\";
    case "mac":
      return "/Users";
    case "linux":
      return "/home";
    default:
      return assertNever(platform);
  }
}

const tempDirectory =
  process.env["RUNNER_TEMP"] ??
  path.join(getBaseLocation(platform), "actions", "temp");

async function run() {
  const userSuppliedVersion = core.getInput("pandoc-version", {
    required: false,
    trimWhitespace: true,
  });

  try {
    const effectiveVersion = await installPandoc(userSuppliedVersion);
    core.debug(`Successfully set up pandoc version ${effectiveVersion}`);

    core.startGroup("Pandoc Information");

    // output the version actually being used
    const pandocPath = await io.which("pandoc");
    const pandocVersion = (
      cp.execSync(`${pandocPath} --version`) ?? ""
    ).toString();
    core.info(pandocVersion);

    core.endGroup();
  } catch (error: any) {
    core.setFailed(error?.message ?? error ?? "Unknown error");
  }
}

async function installPandoc(userSuppliedVersion: string | null | undefined) {
  const effectiveVersion =
    !userSuppliedVersion || userSuppliedVersion.toLowerCase() === "latest"
      ? await fetchLatestVersion()
      : userSuppliedVersion;

  const cachedToolPath = tc.find("pandoc", effectiveVersion);
  if (cachedToolPath) {
    core.info(`Found in cache @ ${cachedToolPath}`);
    core.addPath(cachedToolPath);
    return effectiveVersion;
  }

  core.debug(
    `Fetching pandoc version ${effectiveVersion} (user requested "${userSuppliedVersion}")`,
  );
  await getPandoc(effectiveVersion);

  return effectiveVersion;
}

export async function getPandoc(version: string) {
  switch (platform) {
    case "windows":
      return installPandocWindows(version);
    case "mac":
      return installPandocMac(version);
    case "linux":
      return installPandocLinux(version);
    default:
      return assertNever(platform);
  }
}

//#region Mac

async function installPandocMac(version: string) {
  const [downloadUrl, filename] = getDownloadLink("mac", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error: any) {
    throw new Error(
      `Failed to download Pandoc ${version}: ${error?.message ?? error}`,
    );
  }

  const extractionPath = await tc.extractZip(downloadPath);

  const binDirPath = path.join(extractionPath, `${path.parse(filename).name}/bin`);

  const cachedBinDirPath = await tc.cacheDir(binDirPath, "pandoc", version);
  core.addPath(cachedBinDirPath);
}
//#endregion
//#region Windows

async function installPandocWindows(version: string) {
  const [downloadUrl] = getDownloadLink("windows", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error: any) {
    throw new Error(
      `Failed to download Pandoc ${version}: ${error?.message ?? error}`,
    );
  }

  const extractionPath = await tc.extractZip(downloadPath);

  const binDirPath = path.join(extractionPath, getPandocSubDir(version));

  const cachedBinDirPath = await tc.cacheDir(binDirPath, "pandoc", version);
  core.addPath(cachedBinDirPath);
}

function getPandocSubDir(version: string) {
  if (compare(version, "2.9.2", ">=")) return `pandoc-${version}`;

  if (compare(version, "2.9.1", "=")) return "";

  return `pandoc-${version}-windows-x86_64`;
}

//#endregion
//#region Linux

async function installPandocLinux(version: string) {
  const [downloadUrl] = getDownloadLink("linux", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl, undefined);
  } catch (error: any) {
    throw new Error(
      `Failed to download Pandoc ${version}: ${error?.message ?? error}`,
    );
  }

  const extractionPath = await tc.extractTar(downloadPath);

  const binDirPath = path.join(extractionPath, `pandoc-${version}/bin`);

  const cachedBinDirPath = await tc.cacheDir(binDirPath, "pandoc", version);
  core.addPath(cachedBinDirPath);
}

//#endregion

//#region Version Fetching

type ReleasesResponse = GhRelease[];
interface GhRelease {
  /** Auto-Incrementing ID. higher -> newer */
  id: number;
  draft: boolean;
  url: string;
  tag_name: string;
  assets: GhReleaseAsset[];
}

interface GhReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type: string;
}

function getAuthHeaderValue(): `Bearer ${string}` | undefined {
  const authToken =
    core.getInput("token", {
      // Don't throw or something. It is only used to fetch the latest version of pandoc, so if it's missing,
      // the worst that could happen is hitting the API rate limit.
      required: false,
      trimWhitespace: true,
    }) ?? undefined;

  return !!authToken ? `Bearer ${authToken}` : undefined;
}

async function fetchLatestVersion(): Promise<string> {
  const http = new HttpClient("setup-pandoc", [], {
    allowRedirects: true,
    maxRedirects: 3,
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: getAuthHeaderValue(),
    },
  });

  const latestReleaseUrl =
    "https://api.github.com/repos/jgm/pandoc/releases/latest";
  const release = (await http.getJson<GhRelease>(latestReleaseUrl)).result;
  return release?.tag_name ?? PERMANENT_FALLBACK_VERSION;
}

function getDownloadLink(
  platform: Platform,
  version: string,
): [url: string, fileName: string] {
  const encodedVersion = encodeURIComponent(version);
  const base = `https://github.com/jgm/pandoc/releases/download/${encodedVersion}`;
  const fileName = getDownloadFileName(platform, version);
  return [`${base}/${fileName}`, fileName];
}

function getDownloadFileName(platform: Platform, version: string): string {
  const encodedVersion = encodeURIComponent(version);
  switch (platform) {
    case "linux":
      return `pandoc-${encodedVersion}-linux-amd64.tar.gz`;
    case "windows":
      return `pandoc-${encodedVersion}-windows-x86_64.zip`;
    case "mac":
      if (compare(encodedVersion, "3.1.1", "<=")){
        return `pandoc-${encodedVersion}-macOS.zip`;
      } else {
        return `pandoc-${encodedVersion}-x86_64-macOS.zip`;
      }
    default:
      return assertNever(platform);
  }
}

//#endregion

function assertNever(_: never): never {
  throw new Error("This code should not be reached");
}

run();
