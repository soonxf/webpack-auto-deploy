// 使用 ESM 导入语法
import fs from "fs/promises";
import _fs from "fs";
import ora from "ora";
import archiver from "archiver";
import path from "path";
import { join } from "path";
import chalk from "chalk";
import { promisify } from "util";
import enquirer from "./enquirer.js";

export const isWindowsOrLinuxPath = path => {
  const windowsRegex = /^[a-zA-Z]:\\(?:[^\\\/:*?"<>|\r\n]+\\)*[^\\\/:*?"<>|\r\n]*$/;
  const linuxRegex = /^(\/[^\/:*?"<>|\r\n]+)+\/?$/;
  return windowsRegex.test(path) || linuxRegex.test(path);
};

export const splitArrayIntoChunks = (array, chunkSize = 100) => {
  let result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    let chunk = array.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
};

export const checkFileExists = async filePath => {
  try {
    await fs.access(filePath);
    // 如果没有错误，文件存在
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      // 文件不存在
      return false;
    } else {
      // 其他错误，可能需要进一步处理
      throw error;
    }
  }
};

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
      const _mapPath = path.posix.join(mapPath);
      const files = await fs.readdir(_mapPath);
      for (const item of files) {
        const _join = path.join(_mapPath, item);
        const _posixJoin = path.posix.join(remotePath, item);
        const stats = await fs.stat(_join);
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

    for (const item of splitArrayIntoChunks(fileList.directory)) {
      const response = await Promise.all(item.map(item => item()));

      response.forEach(item => item.success === false && _spinner.fail(chalk.red(`文件夹:${item.path} 创建失败\n`)));
    }

    for (const item of splitArrayIntoChunks(fileList.file)) {
      const response = await Promise.all(item.map(item => item()));

      response.forEach(item => item.success === false && _spinner.fail(chalk.red(`文件:${item.path} 上传失败\n`)));
    }

    const endTime = Date.now();

    _spinner.succeed(chalk.green(`上传结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟\n`));
  } catch (error) {
    _spinner.succeed(chalk.red("上传失败\n"));
    console.warn(chalk.red(error));
  }
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

    const targetFiles = remotePath.split(/[\\/]+/).pop();

    const spinner = ora("服务器正在备份...\n").start();

    try {
      Client.exec(`cd ${remotePath};cd ../;tar -czvf ${fileName} ${targetFiles}`, (err, stream) => {
        if (!!err) return resolve(false);
        stream.on("data", data => {});
        stream.stderr.on("data", data => {});
        stream.on("close", (code, signal) => {
          if (code === 0) {
            spinner.succeed(chalk.green("备份成功"));
            resolve(1);
          } else {
            spinner.fail(chalk.red("备份失败"));
            resolve(1);
          }
        });
      });
    } catch (error) {
      spinner.fail(chalk.red(error));
      Client.end();
      resolve(1);
    }
  });
};

export const compress = (fileName, localPath) => {
  return new Promise((resolve, reject) => {
    // 确保输出文件的路径是正确的
    const lastPath = `${localPath
      .split(/[\\/]+/)
      .filter(item => item !== "")
      .pop()}_`;

    const outputPath = path.join(localPath, "../", lastPath, fileName.replace(".tar.gz", ".zip"));

    const dirname = path.join(localPath, "../", lastPath);

    if (_fs.existsSync(dirname) === false) {
      _fs.mkdirSync(dirname);
    }

    const output = _fs.createWriteStream(outputPath);

    const archive = archiver("zip", {
      zlib: { level: 9 }, // 设置压缩级别
    });

    output.on("close", function () {
      resolve(outputPath); // 返回压缩文件的路径
    });

    archive.on("warning", function (err) {
      if (err.code === "ENOENT") {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on("error", function (err) {
      reject(err);
    });

    archive.pipe(output);

    // 递归地添加目录到归档中
    archive.directory(localPath, false);

    // 完成归档
    archive.finalize();
  });
};

export const bytesToMB = bytes => {
  return (bytes / 1024 / 1024).toFixed(2);
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
      const _itemPath = path.posix.join(itemPath, item.filename);

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

  for (const item of splitArrayIntoChunks(fileList.file)) {
    const response = await Promise.all(item.map(item => item()));

    response.forEach(item => item.success === false && spinner.fail(chalk.red(`文件:${item.path} 删除失败\n`)));
  }
  for (const item of splitArrayIntoChunks(fileList.directory)) {
    const response = await Promise.all(item.map(item => item()));

    response.forEach(item => item.success === false && spinner.fail(chalk.red(`目录:${item.path} 删除失败\n`)));
  }

  const endTime = Date.now();

  _spinner.succeed(chalk.green(`删除结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟`));
};

export const mkdirRemotePath = async (Client, sftp, remotePath) => {
  const statSync = promisify(sftp.stat.bind(sftp));
  const mkdirSync = promisify(sftp.mkdir.bind(sftp));
  const _posixJoin = path.posix.join(remotePath);

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
  const file = await fs.readFile(filePath, { encoding: "utf8" });
  const json = JSON.parse(file);
  return json;
};

export const formatConfig = config => {
  return Object.keys(config).map((item, index) => {
    const privateKey = config[item].serverOptions.privateKey === undefined;
    return {
      ...config[item],
      appName: item,
      localPath: join(process.cwd(), config[item].localPath),
      serverOptions: {
        ...config[item].serverOptions,
        password: privateKey ? config[item].serverOptions.password : undefined,
        privateKey: privateKey ? undefined : join(process.cwd(), config[item].serverOptions.privateKey),
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

export const generateTemplateConfig = async filePath => {
  const spinner = ora(chalk.green("正在生成配置文件模板...")).start();

  await delay(3000);

  const config = await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        appName_1: {
          compress: true,
          environment: "dev",
          localPath: "./pkg",
          remotePath: "/home/backup",
          serverOptions: {
            host: "192.168.1.1",
            port: "22",
            username: "root",
            password: "12345678",
          },
        },
        appName_2: {
          compress: true,
          environment: "test",
          localPath: "./pkg",
          remotePath: "/home/backup",
          serverOptions: {
            host: "192.168.1.2",
            port: "22",
            username: "root",
            password: "12345678",
            passphrase: "12345678",
            privateKey: "./rsa.txt",
          },
        },
        appName_3: {
          compress: true,
          environment: "prod",
          localPath: "./pkg",
          remotePath: "/home/backup",
          serverOptions: {
            host: "192.168.1.3",
            port: "22",
            username: "root",
            password: "12345678",
            passphrase: "12345678",
            privateKey: "./rsa.txt",
          },
        },
      },
      null,
      2,
    ),
    { encoding: "utf8" },
  );

  spinner.succeed(chalk.green("配置文件模板生成成功\n"));
  spinner.succeed(chalk.green(`配置文件 ${filePath}\n`));
  spinner.succeed(chalk.green(`请修改配置后重新执行命令\n`));

  await delay(1000);

  return config;
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
  splitArrayIntoChunks,
  backup,
  mkdirRemotePath,
  checkFileExists,
  readJson,
  formatConfig,
  generateTemplateConfig,
};
