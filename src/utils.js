// 使用 ESM 导入语法
import { existsSync, mkdirSync, createWriteStream, promises } from "fs";
import ora from "ora";
import archiver from "archiver";
import { join, isAbsolute, dirname, posix, basename, normalize } from "path";
import chalk from "chalk";
import { promisify } from "util";
import { fileURLToPath } from "url";
import enquirer from "./enquirer.js";

// 获取当前文件的路径
const __filename = fileURLToPath(import.meta.url);
// 获取当前文件所在目录的路径
const __dirname = dirname(__filename);

export const uploadDirectory = async (sftp, localPath, remotePath) => {
  const _spinner = ora("服务器正在上传...\n");

  try {
    const mkdirSync = promisify(sftp.mkdir.bind(sftp));
    const fastPutSync = promisify(sftp.fastPut.bind(sftp));
    const statSync = promisify(sftp.stat.bind(sftp));

    const uploadSize = {
      directory: {
        num: 0,
        size: 0,
      },
      file: {
        num: 0,
        size: 0,
      },
    };

    const _uploadDirectory = async (mapPath, remotePath) => {
      const fileList = {
        directory: [],
        file: [],
      };
      const _mapPath = posix.join(mapPath);
      const files = await promises.readdir(_mapPath);
      for (const item of files) {
        const _join = join(_mapPath, item);
        const _posixJoin = posix.join(remotePath, item);
        const stats = await promises.stat(_join);
        if (stats.isDirectory()) {
          uploadSize.directory.size += stats.size;
          uploadSize.directory.num += 1;
          fileList.directory.push(async () => {
            const isExist = await statSync(_posixJoin)
              .then(() => true)
              .catch(() => false);

            if (isExist) {
              return {
                success: true,
                path: _posixJoin,
              };
            }

            const response = await mkdirSync(_posixJoin);
            return {
              success: response === undefined ? true : false,
              path: _posixJoin,
            };
          });
          const _fileList = await _uploadDirectory(_join, _posixJoin);
          fileList.directory = fileList.directory.concat(_fileList.directory);
          fileList.file = fileList.file.concat(_fileList.file);
        } else {
          uploadSize.file.size += stats.size;
          uploadSize.file.num += 1;
          fileList.file.push(async () => {
            const response = await fastPutSync(_join, _posixJoin);
            return {
              success: response === undefined ? true : false,
              path: _posixJoin,
            };
          });
        }
      }
      return fileList;
    };

    const fileList = await _uploadDirectory(localPath, remotePath);

    outputStatistics("待上传", uploadSize);

    _spinner.start();

    const startTime = Date.now();

    await processTask(_spinner, fileList.directory, "directory", "upload");

    await processTask(_spinner, fileList.file, "file", "upload");

    const endTime = Date.now();

    _spinner.succeed(chalk.green(`上传结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟\n`));
  } catch (error) {
    _spinner.succeed(chalk.red("上传失败\n"));
    console.warn(chalk.red(error));
  }
};

export const deleteDirectory = async (sftp, remotePath) => {
  const readdirSync = promisify(sftp.readdir.bind(sftp));
  const rmdirSync = promisify(sftp.rmdir.bind(sftp));
  const unlinkSync = promisify(sftp.unlink.bind(sftp));

  const fileList = {
    directory: [],
    file: [],
  };

  const deleteSize = {
    directory: {
      num: 0,
      size: 0,
    },
    file: {
      num: 0,
      size: 0,
    },
  };

  const _deleteDirectory = async itemPath => {
    const files = await readdirSync(itemPath);
    for (const item of files) {
      const _itemPath = posix.join(itemPath, item.filename);

      if (item.attrs.isDirectory()) {
        await _deleteDirectory(_itemPath);
        deleteSize.directory.num += 1;
        deleteSize.directory.size += item.attrs.size;
        fileList.directory.push(async () => {
          try {
            const response = await rmdirSync(_itemPath);
            return {
              success: response === undefined ? true : false,
              path: _itemPath,
            };
          } catch (error) {
            return {
              success: false,
              path: _itemPath,
            };
          }
        });
      } else {
        deleteSize.file.num += 1;
        deleteSize.file.size += item.attrs.size;
        fileList.file.push(async () => {
          try {
            const response = await unlinkSync(_itemPath);
            return {
              success: response === undefined ? true : false,
              path: _itemPath,
            };
          } catch (error) {
            return {
              success: false,
              path: _itemPath,
            };
          }
        });
      }
    }
  };

  const startTime = Date.now();

  const spinner = ora("正在统计...\n").start();

  await _deleteDirectory(remotePath);

  spinner.succeed(chalk.green("统计结束"));

  outputStatistics("待删除", deleteSize);

  const _spinner = ora("服务器正在删除...\n").start();

  await processTask(_spinner, fileList.file, "file", "delete");

  await processTask(_spinner, fileList.directory, "directory", "delete");

  const endTime = Date.now();

  _spinner.succeed(chalk.green(`删除结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟`));
};

export const backup = (Client, fileName, remotePath) => {
  return new Promise(async (resolve, reject) => {
    const sftpSync = promisify(Client.sftp.bind(Client));

    const sftp = await sftpSync();

    const response = await mkdirRemotePath(Client, sftp, remotePath);

    if (response === 2) return resolve(2);

    if (response === 0) return resolve(0);

    const _response = await enquirer.backup();

    if (!_response) return resolve(true);

    const remoteDirName = basename(remotePath);
    const remoteDirPath = dirname(remotePath);
    const remoteFilePath = normalize(join(remoteDirPath, fileName)).replace(/\\/g, "/");

    const spinner = ora("服务器正在备份...\n").start();

    try {
      const tarCommand = `tar -czvf ${remoteFilePath} -C ${remoteDirPath} ${remoteDirName}`;

      Client.exec(tarCommand, (err, stream) => {
        if (!!err) return resolve(1);
        stream.on("data", data => {});
        stream.stderr.on("data", data => {});
        stream.on("close", (code, signal) => {
          if (code === 0) {
            spinner.succeed(chalk.green("备份成功"));
            resolve(1);
            return;
          }
          spinner.fail(chalk.red("备份失败"));
          resolve(1);
        });
      });
    } catch (error) {
      spinner.fail(chalk.red(error));
      Client.end();
      resolve(1);
    }
  });
};

export const mkdirRemotePath = async (Client, sftp, remotePath) => {
  const statSync = promisify(sftp.stat.bind(sftp));
  const mkdirSync = promisify(sftp.mkdir.bind(sftp));
  const _posixJoin = posix.join(remotePath);

  const isExist = await statSync(_posixJoin)
    .then(() => true)
    .catch(() => false);

  if (isExist) return 1;

  const response = await enquirer.mkdirRemotePath();
  if (response) {
    const _response = await mkdirSync(_posixJoin);
    if (_response === undefined) {
      console.log(chalk.green(`远程目录 ${remotePath} 创建成功`));
      return 0;
    }
  } else {
    Client.end();
    return 2;
  }
};

export const compress = (fileName, localPath) => {
  return new Promise((resolve, reject) => {
    const _localPath = basename(toNormalize(localPath));
    const _dirname = dirname(localPath);
    const lastPath = join(_dirname, `${_localPath}_`);

    const outputPath = join(
      isAbsolute(lastPath) ? lastPath : join(process.cwd(), lastPath),
      fileName.replace(".tar.gz", ".zip"),
    );

    if (existsSync(lastPath) === false) mkdirSync(lastPath);

    const output = createWriteStream(outputPath);

    const archive = archiver("zip", {
      zlib: { level: 1 }, // 设置压缩级别
    });

    output.on("close", () => resolve(outputPath));
    archive.on("warning", err => (err.code === "ENOENT" ? console.warn(err) : reject(err)));
    archive.on("error", err => reject(err));
    archive.pipe(output);
    archive.directory(localPath, false);
    archive.finalize();
  });
};

export const outputStatistics = (type, statistics) => {
  console.log(
    chalk.green(
      `\n${type} 文件夹:${statistics.directory.num} 个, 文件:${statistics.file.num} 个, 总大小:${bytesToMB(
        statistics.directory.size + statistics.file.size,
      )} MB\n`,
    ),
  );
};

export const readJson = async filePath => {
  const file = await promises.readFile(filePath, { encoding: "utf8" });
  const json = JSON.parse(file);
  return json;
};

export const processTask = async (_spinner, items, itemType, taskType = "upload") => {
  const message = {
    upload: ["创建", "上传"],
    delete: ["删除", "删除"],
  };

  const splitArrayIntoChunks = (array, chunkSize = 100) => {
    let result = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      let chunk = array.slice(i, i + chunkSize);
      result.push(chunk);
    }
    return result;
  };

  for (const chunk of splitArrayIntoChunks(items)) {
    const responses = await Promise.all(chunk.map(item => item()));
    responses.forEach(item => {
      if (item.success === false) {
        const typeText = itemType === "directory" ? "文件夹" : "文件";
        _spinner.fail(
          chalk.red(
            `${typeText}:${item.path} ${itemType === "directory" ? message[taskType][0] : message[taskType][0]}失败\n`,
          ),
        );
      }
    });
  }
};

export const generateTemplateConfig = async filePath => {
  const spinner = ora(chalk.green("正在生成配置文件模板...")).start();

  const json = await readJson(join(__dirname, "../", "./webpack.deploy.json"));

  await delay(2000);

  const config = await promises.writeFile(filePath, JSON.stringify(json, null, 3), {
    encoding: "utf8",
  });

  spinner.succeed(chalk.green("配置文件模板生成成功\n"));
  spinner.succeed(chalk.green(`配置文件 ${filePath}\n`));
  spinner.succeed(chalk.green(`请修改配置后重新执行命令\n`));

  await delay(1000);

  return config;
};

export const formatConfig = config => {
  return Object.keys(config).map((item, index) => {
    const privateKey = config[item].serverOptions.privateKey === undefined;
    return {
      ...config[item],
      appName: item,
      localPath: join(isAbsolute(process.cwd()) ? "" : process.cwd(), config[item].localPath),
      serverOptions: {
        ...config[item].serverOptions,
        password: privateKey ? config[item].serverOptions.password : undefined,
        privateKey: privateKey
          ? undefined
          : join(isAbsolute(process.cwd()) ? "" : process.cwd(), config[item].serverOptions.privateKey),
      },
    };
  });
};

export const delay = (time = 500, callBack) => {
  return new Promise(resolve => {
    let timer = setTimeout(() => resolve(timer), time);
  }).then(response => {
    response && clearTimeout(response);
    callBack?.();
  });
};

export const isObject = value => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export const isWindowsOrLinuxPath = path => {
  const windowsRegex = /^[a-zA-Z]:[\/\\](?:[^\\\/:*?"<>|\r\n]+[\/\\])*[^\\\/:*?"<>|\r\n]*$/;
  const linuxRegex = /^(\/[^\/:*?"<>|\r\n]+)+\/?$/;
  return windowsRegex.test(path) || linuxRegex.test(path);
};

export const checkFileExists = async filePath => {
  try {
    await promises.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

export const bytesToMB = bytes => {
  return (bytes / 1024 / 1024).toFixed(2);
};

export const toNormalize = _path => {
  return normalize(_path ?? "").replace(/\\/g, "/");
};

Object.defineProperty(Date.prototype, "__format", {
  value: function (fmt = "yyyy-MM-dd hh:mm:ss") {
    const o = {
      "M+": this.getMonth() + 1, //月份
      "d+": this.getDate(), //日
      "h+": this.getHours(), //小时
      "m+": this.getMinutes(), //分
      "s+": this.getSeconds(), //秒
      "q+": Math.floor((this.getMonth() + 3) / 3), //季度
      S: this.getMilliseconds(), //毫秒
    };

    /(y+)/.test(fmt) && (fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length)));

    for (var k in o)
      new RegExp("(" + k + ")").test(fmt) &&
        (fmt = fmt.replace(RegExp.$1, RegExp.$1.length == 1 ? o[k] : ("00" + o[k]).substr(("" + o[k]).length)));

    return fmt;
  },
  writable: false,
  configurable: false,
  enumerable: false,
});

Object.defineProperty(String, "__generateRandomString", {
  value: function (length = 6) {
    return length <= 11
      ? Math.random()
          .toString(36)
          .substring(2, length + 2)
          .padEnd(length, "0")
      : String.__generateRandomString(11) + String.__generateRandomString(length - 11);
  },
  writable: false,
  configurable: false,
  enumerable: false,
});

export default {
  bytesToMB,
  deleteDirectory,
  outputStatistics,
  backup,
  mkdirRemotePath,
  checkFileExists,
  readJson,
  formatConfig,
  generateTemplateConfig,
  isObject,
};
