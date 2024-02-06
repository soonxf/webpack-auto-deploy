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
  try {
    // Promisify SFTP操作
    const makeDir = promisify(sftp.mkdir.bind(sftp));
    const fastPut = promisify(sftp.fastPut.bind(sftp));
    const checkStat = promisify(sftp.stat.bind(sftp));

    // 用于统计上传进度的对象
    const uploadStats = { directory: { count: 0, size: 0 }, file: { count: 0, size: 0 } };

    const uploadDirectoryEntry = async (remotePath, statFunc, mkdirFunc) => {
      try {
        const exists = await statFunc(remotePath)
          .then(() => true)
          .catch(() => false);

        if (!exists) {
          const result = await mkdirFunc(remotePath);
          return { success: result === undefined, path: remotePath };
        }
        return { success: true, path: remotePath };
      } catch (error) {
        return { success: false, path: remotePath };
      }
    };

    const uploadFileEntry = async (localFilePath, remoteFilePath) => {
      try {
        const response = await fastPut(localFilePath, remoteFilePath);
        return {
          success: response === undefined ? true : false,
          path: remoteFilePath,
        };
      } catch {
        return { success: false, path: remoteFilePath };
      }
    };

    // 递归上传目录的内部函数
    const recursiveUpload = async (_localPath, _remotePath) => {
      // File removal tracker
      const fileList = { directory: [], file: [] };

      const localFiles = await promises.readdir(_localPath);

      for (const file of localFiles) {
        const localFilePath = join(_localPath, file);
        const remoteFilePath = posix.join(_remotePath, file);
        const stats = await promises.stat(localFilePath);

        if (stats.isDirectory()) {
          // 如果是目录，递归处理
          uploadStats.directory.size += stats.size;
          uploadStats.directory.count += 1;
          fileList.directory.push(async () => await uploadDirectoryEntry(remoteFilePath, checkStat, makeDir));

          // 进行嵌套上传并合并结果
          const nestedFiles = await recursiveUpload(localFilePath, remoteFilePath);
          fileList.directory.push(...nestedFiles.directory);
          fileList.file.push(...nestedFiles.file);
        } else {
          // 如果是文件，添加到上传列表
          uploadStats.file.size += stats.size;
          uploadStats.file.count += 1;
          fileList.file.push(async () => await uploadFileEntry(localFilePath, remoteFilePath));
        }
      }

      return fileList;
    };

    const taskQueue = await recursiveUpload(localPath, remotePath);

    outputStatistics("待上传", uploadStats); // 输出待上传统计信息

    // 显示上传状态的动态标识
    const spinner = ora("服务器正在上传...\n").start();

    const startTime = Date.now();

    (await processTask(taskQueue.directory, "directory", "upload")).map(item => console.log(item));
    (await processTask(taskQueue.file, "file", "upload")).map(item => console.log(item));

    const endTime = Date.now();

    spinner.succeed(chalk.green(`上传结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟\n`));
  } catch (error) {
    console.log(chalk.red("上传失败\n"));
    console.error(chalk.red(error));
    throw error;
  }
};

export const deleteDirectory = async (sftp, remotePath) => {
  // Promisify sftp methods for asynchronous operation
  const readdirAsync = promisify(sftp.readdir.bind(sftp));
  const rmdirAsync = promisify(sftp.rmdir.bind(sftp));
  const unlinkAsync = promisify(sftp.unlink.bind(sftp));

  const fileList = { directory: [], file: [] };

  const deleteSize = { directory: { count: 0, size: 0 }, file: { count: 0, size: 0 } };

  // Recursively delete directories and their contents
  const recursivelyDelete = async itemPath => {
    const files = await readdirAsync(itemPath);

    for (const item of files) {
      const fullPath = posix.join(itemPath, item.filename);

      if (item.attrs.isDirectory()) {
        await recursivelyDelete(fullPath);
        deleteSize.directory.count++;
        deleteSize.directory.size += item.attrs.size; // 更新目录大小统计
        fileList.directory.push(async () => await removeDirectory(fullPath));
      } else {
        deleteSize.file.count++;
        deleteSize.file.size += item.attrs.size; // 更新文件大小统计
        fileList.file.push(async () => await removeFile(fullPath));
      }
    }
  };

  // Remove file and handle result
  const removeFile = async filePath => {
    try {
      const response = await unlinkAsync(filePath);
      return { success: response === undefined, path: filePath };
    } catch (error) {
      return { success: false, path: filePath };
    }
  };

  // Remove directory and handle result
  const removeDirectory = async directoryPath => {
    try {
      const response = await rmdirAsync(directoryPath);
      return { success: response === undefined, path: directoryPath };
    } catch (error) {
      return { success: false, path: directoryPath };
    }
  };

  const spinner = ora("正在统计...\n").start();

  await recursivelyDelete(remotePath);

  spinner.succeed(chalk.green("统计结束"));

  outputStatistics("待删除", deleteSize);

  const _spinner = ora("服务器正在删除...\n").start();

  const startTime = Date.now();

  (await processTask(fileList.file, "file", "delete")).map(item => console.log(item));
  (await processTask(fileList.directory, "directory", "delete")).map(item => console.log(item));

  const endTime = Date.now();

  _spinner.succeed(chalk.green(`删除结束 耗时:${((endTime - startTime) / 1000 / 60).toFixed(3)} 分钟`));
};

export const backup = (Client, fileName, remotePath) => {
  return new Promise(async resolve => {
    // 使用promisify工具来创建支持Promise的SFTP操作函数
    const sftp = await promisify(Client.sftp.bind(Client))();

    // 如果remotePath不存在则创建
    const pathExists = await mkdirRemotePath(Client, sftp, remotePath);
    if (pathExists === 2) {
      resolve(2);
      return;
    }
    if (pathExists === 0) {
      resolve(0);
      return;
    }

    // 使用enquirer库查询用户是否希望执行备份
    const userInput = await enquirer.backup();
    if (!userInput) {
      // 用户取消备份操作
      resolve(true);
      return;
    }

    // 处理路径，获取备份文件的完整远程路径
    const remoteDirName = basename(remotePath);
    const remoteDirPath = dirname(remotePath);
    const remoteFilePath = normalize(join(remoteDirPath, fileName)).replace(/\\/g, "/");

    // 启动ora spinner，提示用户备份正在进行
    const spinner = ora("服务器正在备份...\n").start();

    try {
      // 构建并执行tar命令以创建备份
      const tarCommand = `tar -czvf ${remoteFilePath} -C ${remoteDirPath} ${remoteDirName}`;
      Client.exec(tarCommand, (err, stream) => {
        if (err) {
          // 如果执行过程中发生错误，解析Promise并返回1
          resolve(1);
          spinner.fail(chalk.red("备份失败"));
          return;
        }

        // 监听过程中的数据流，但不执行任何操作，可根据需求进行日志记录
        stream.on("data", () => {});
        stream.stderr.on("data", () => {});

        // 当备份过程结束时
        stream.on("close", code => {
          if (code === 0) {
            // 如果退出代码为0，备份成功
            spinner.succeed(chalk.green("备份成功"));
            resolve(1);
          } else {
            // 如果退出代码非0，备份失败
            spinner.fail(chalk.red("备份失败"));
            resolve(1);
          }
        });
      });
    } catch (error) {
      // 捕获并处理任何异常
      spinner.fail(chalk.red(error.message));
      Client.end();
      resolve(1);
    }
  });
};

export const mkdirRemotePath = async (Client, sftp, remotePath) => {
  // 将sftp的stat和mkdir方法转换为异步版本
  const stat = promisify(sftp.stat.bind(sftp));
  const mkdir = promisify(sftp.mkdir.bind(sftp));
  // 使用posix.join确保路径在不同系统中正确
  const fullPath = posix.join(remotePath);

  // 检查远程目录是否存在
  const exists = await stat(fullPath)
    .then(() => true)
    .catch(() => false);

  // 如果存在，直接返回1
  if (exists) return 1;

  // 插询用户是否创建不存在的目录
  const shouldCreate = await enquirer.mkdirRemotePath();
  if (!shouldCreate) {
    // 用户选择不创建，结束客户端连接并返回2
    Client.end();
    return 2;
  }

  try {
    // 创建目录, mkdir方法成功执行时不返回任何值 (即undefined)
    const makeDirResponse = await mkdir(fullPath);
    if (makeDirResponse === undefined) {
      console.log(chalk.green(`远程目录 ${remotePath} 创建成功`));
      // 目录创建成功，返回0
      return 0;
    }
  } catch (error) {
    // 如果创建过程中出错，打印错误信息，结束客户端连接
    console.error(chalk.red(`远程目录创建失败: ${error.message}`));
    Client.end();
    // 设计上不应该到达这里，如果创建目录失败应该抛出异常，因此这里没有返回值说明，但可以添加返回值以便于后续逻辑处理
    return 3;
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
      `\n${type} 文件夹:${statistics.directory.count} 个, 文件:${statistics.file.count} 个, 总大小:${bytesToMB(
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

export const processTask = async (items, itemType, taskType = "upload") => {
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

  let responses = [];

  for (const chunk of splitArrayIntoChunks(items)) {
    // console.log(chunk);
    const _responses = await Promise.all(chunk.map(item => item()));
    responses = _responses
      .filter(item => item.success === false)
      .map(item => {
        const typeText = itemType === "directory" ? "文件夹" : "文件";
        return chalk.red(
          `${typeText}:${item.path} ${itemType === "directory" ? message[taskType][0] : message[taskType][0]}失败\n`,
        );
      });
  }
  return responses;
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
