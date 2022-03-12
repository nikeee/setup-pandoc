import * as path from "path";
import cp from "child_process";

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as httpm from "@actions/http-client";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import { compare } from "compare-versions";

const PERMANENT_FALLBACK_VERSION = "2.17.1.1";

type Platform = "windows" | "mac" | "linux";

const platform: Platform = process.platform === "win32"
  ? "windows"
  : process.platform === "darwin"
    ? "mac"
    : "linux";

function getBaseLocation(platform: Platform) {
  switch (platform) {
    case "windows":
      // On windows, use the USERPROFILE env variable
      return process.env["USERPROFILE"] ?? "C:\\"
    case "mac":
      return "/Users";
    case "linux":
      return "/home";
    default:
      return assertNever(platform);
  }
}

const tempDirectory = process.env["RUNNER_TEMP"] ?? path.join(getBaseLocation(platform), "actions", "temp");

async function run() {
  const userSuppliedVersion = core.getInput("pandoc-version", {
    required: false,
    trimWhitespace: true,
  });

  try {
    const effectiveVersion = !userSuppliedVersion || userSuppliedVersion.toLowerCase() === "latest"
      ? await fetchLatestVersion()
      : userSuppliedVersion;

    core.debug(`Fetching pandoc version ${effectiveVersion} (user requested "${userSuppliedVersion}")`);
    await getPandoc(effectiveVersion);

    // core.addPath(installDir);
    // core.info("Added pandoc to the path");
    core.info(`Successfully set up pandoc version ${effectiveVersion}`);

    // output the version actually being used
    const pandocPath = await io.which("pandoc");
    const pandocVersion = (cp.execSync(`${pandocPath} --version`) ?? "").toString();
    core.info(pandocVersion);

  } catch (error: any) {
    core.setFailed(error?.message ?? error ?? "Unknown error");
  }
}

export async function getPandoc(version: string) {
  switch (platform) {
    case "windows": return installPandocWindows(version);
    case "mac": return installPandocMac(version);
    case "linux": return installPandocLinux(version);
    default: return assertNever(platform);
  }
}

function getDownloadLink(platform: Platform, version: string): [url: string, fileName: string] {
  const encodedVersion = encodeURIComponent(version);
  const base = `https://github.com/jgm/pandoc/releases/download/${encodedVersion}`;
  const fileName = getDownloadFileName(platform, version);
  return [
    `${base}/${fileName}`,
    fileName,
  ];
}

function getDownloadFileName(platform: Platform, version: string) {
  const encodedVersion = encodeURIComponent(version);
  switch (platform) {
    case "linux": return `pandoc-${encodedVersion}-1-amd64.deb`; // TODO: Use tarball
    case "windows": return `pandoc-${encodedVersion}-windows-x86_64.zip`;
    case "mac": return `pandoc-${encodedVersion}-macOS.pkg`;
    default: return assertNever(platform);
  }
}

//#region Mac

async function installPandocMac(version: string) {
  const [downloadUrl, fileName] = getDownloadLink("mac", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error) {
    throw new Error(`Failed to download Pandoc ${version}: ${error}`);
  }

  await io.mv(downloadPath, path.join(tempDirectory, fileName));

  exec.exec("sudo installer", [
    "-allowUntrusted",
    "-dumplog",
    "-pkg",
    path.join(tempDirectory, fileName),
    "-target",
    "/"
  ]);
}

//#endregion
//#region Windows

async function installPandocWindows(version: string) {
  const [downloadUrl] = getDownloadLink("windows", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error) {
    throw `Failed to download Pandoc ${version}: ${error}`;
  }

  if (!tempDirectory) {
    throw new Error("Temp directory not set");
  }

  const extPath = await tc.extractZip(downloadPath);

  const toolPath = await tc.cacheDir(extPath, "pandoc", version);

  // It extracts to this folder
  const toolRoot = path.join(toolPath, getPandocSubDir(version));

  core.addPath(toolRoot);
}

function getPandocSubDir(version: string) {
  if (compare(version, "2.9.2", ">="))
    return `pandoc-${version}`;

  if (compare(version, "2.9.1", "="))
    return "";

  return `pandoc-${version}-windows-x86_64`;
}

//#endregion
//#region Linux (Debian)

async function installPandocLinux(version: string) {
  const [downloadUrl, fileName] = getDownloadLink("linux", version);

  let downloadPath: string;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error) {
    throw `Failed to download Pandoc ${version}: ${error}`;
  }

  await io.mv(downloadPath, path.join(tempDirectory, fileName));

  try {
    await exec.exec("sudo", ["dpkg", "-i", path.join(tempDirectory, fileName)]);
  } catch (error: any) {
    throw new Error(`Failed to install pandoc: ${error}`);
  }
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

async function getAvailableVersions(): Promise<ReleasesResponse | undefined> {
  // this returns versions descending so latest is first
  const http = new httpm.HttpClient("setup-hurl", [], {
    allowRedirects: true,
    maxRedirects: 3
  });

  const url = "https://api.github.com/repos/jgm/pandoc/releases";
  const res = (await http.getJson<ReleasesResponse>(url)).result;

  return res
    ? res.filter(r => !r.draft).sort((a, b) => b.id - a.id)
    : undefined;
}

async function fetchLatestVersion(): Promise<string> {
  const versions = await getAvailableVersions();
  return versions?.[0]?.tag_name ?? PERMANENT_FALLBACK_VERSION;
}


//#endregion

function assertNever(_: never): never {
  throw new Error("This code should not be reached");
}

run();
