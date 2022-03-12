"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPandoc = void 0;
const path = __importStar(require("path"));
const child_process_1 = __importDefault(require("child_process"));
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const httpm = __importStar(require("@actions/http-client"));
const io = __importStar(require("@actions/io"));
const tc = __importStar(require("@actions/tool-cache"));
const compare_versions_1 = require("compare-versions");
const PERMANENT_FALLBACK_VERSION = "2.17.1.1";
const platform = process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
        ? "mac"
        : "linux";
function getBaseLocation(platform) {
    switch (platform) {
        case "windows":
            return process.env["USERPROFILE"] ?? "C:\\";
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
        const effectiveVersion = await installPandoc(userSuppliedVersion);
        core.debug(`Successfully set up pandoc version ${effectiveVersion}`);
        core.startGroup("Pandoc Information");
        const pandocPath = await io.which("pandoc");
        const pandocVersion = (child_process_1.default.execSync(`${pandocPath} --version`) ?? "").toString();
        core.info(pandocVersion);
        core.endGroup();
    }
    catch (error) {
        core.setFailed(error?.message ?? error ?? "Unknown error");
    }
}
async function installPandoc(userSuppliedVersion) {
    const effectiveVersion = !userSuppliedVersion || userSuppliedVersion.toLowerCase() === "latest"
        ? await fetchLatestVersion()
        : userSuppliedVersion;
    const cachedToolPath = tc.find("pandoc", effectiveVersion);
    if (cachedToolPath) {
        core.info(`Found in cache @ ${cachedToolPath}`);
        core.addPath(cachedToolPath);
        return effectiveVersion;
    }
    core.debug(`Fetching pandoc version ${effectiveVersion} (user requested "${userSuppliedVersion}")`);
    await getPandoc(effectiveVersion);
    return effectiveVersion;
}
async function getPandoc(version) {
    switch (platform) {
        case "windows": return installPandocWindows(version);
        case "mac": return installPandocMac(version);
        case "linux": return installPandocLinux(version);
        default: return assertNever(platform);
    }
}
exports.getPandoc = getPandoc;
async function installPandocMac(version) {
    const [downloadUrl, fileName] = getDownloadLink("mac", version);
    let downloadPath;
    try {
        downloadPath = await tc.downloadTool(downloadUrl);
    }
    catch (error) {
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
async function installPandocWindows(version) {
    const [downloadUrl] = getDownloadLink("windows", version);
    let downloadPath;
    try {
        downloadPath = await tc.downloadTool(downloadUrl);
    }
    catch (error) {
        throw new Error(`Failed to download Pandoc ${version}: ${error?.message ?? error}`);
    }
    const extractionPath = await tc.extractZip(downloadPath);
    const binDirPath = path.join(extractionPath, getPandocSubDir(version));
    const cachedBinDirPath = await tc.cacheDir(binDirPath, "pandoc", version);
    core.addPath(cachedBinDirPath);
}
function getPandocSubDir(version) {
    if ((0, compare_versions_1.compare)(version, "2.9.2", ">="))
        return `pandoc-${version}`;
    if ((0, compare_versions_1.compare)(version, "2.9.1", "="))
        return "";
    return `pandoc-${version}-windows-x86_64`;
}
async function installPandocLinux(version) {
    const [downloadUrl] = getDownloadLink("linux", version);
    let downloadPath;
    try {
        downloadPath = await tc.downloadTool(downloadUrl, undefined);
    }
    catch (error) {
        throw new Error(`Failed to download Pandoc ${version}: ${error?.message ?? error}`);
    }
    const extractionPath = await tc.extractTar(downloadPath);
    const binDirPath = path.join(extractionPath, `pandoc-${version}/bin`);
    const cachedBinDirPath = await tc.cacheDir(binDirPath, "pandoc", version);
    core.addPath(cachedBinDirPath);
}
async function getAvailableVersions() {
    const http = new httpm.HttpClient("setup-pandoc", [], {
        allowRedirects: true,
        maxRedirects: 3
    });
    const url = "https://api.github.com/repos/jgm/pandoc/releases";
    const res = (await http.getJson(url)).result;
    return res
        ? res.filter(r => !r.draft).sort((a, b) => b.id - a.id)
        : undefined;
}
async function fetchLatestVersion() {
    const versions = await getAvailableVersions();
    return versions?.[0]?.tag_name ?? PERMANENT_FALLBACK_VERSION;
}
function getDownloadLink(platform, version) {
    const encodedVersion = encodeURIComponent(version);
    const base = `https://github.com/jgm/pandoc/releases/download/${encodedVersion}`;
    const fileName = getDownloadFileName(platform, version);
    return [
        `${base}/${fileName}`,
        fileName,
    ];
}
function getDownloadFileName(platform, version) {
    const encodedVersion = encodeURIComponent(version);
    switch (platform) {
        case "linux": return `pandoc-${encodedVersion}-linux-amd64.tar.gz`;
        case "windows": return `pandoc-${encodedVersion}-windows-x86_64.zip`;
        case "mac": return `pandoc-${encodedVersion}-macOS.pkg`;
        default: return assertNever(platform);
    }
}
function assertNever(_) {
    throw new Error("This code should not be reached");
}
run();
