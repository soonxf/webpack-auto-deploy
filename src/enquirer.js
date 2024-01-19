import enquirer from "enquirer";

export const connect = async () => {
  const answer = await new enquirer.Select({
    name: "ready",
    message: "确认连接服务器",
    choices: ["确认", "取消"],
  })
    .run()
    .catch(console.error);

  return answer === "确认" ? true : false;
};

export const backup = async () => {
  const answer = await new enquirer.Select({
    name: "ready",
    message: "确认备份服务器目录下所有文件",
    choices: ["确认", "取消"],
  })
    .run()
    .catch(console.error);

  return answer === "确认" ? true : false;
};

export const mkdirRemotePath = async () => {
  const answer = await new enquirer.Select({
    name: "ready",
    message: "远程目录不存在，是否创建",
    choices: ["确认", "取消"],
  })
    .run()
    .catch(console.error);

  return answer === "确认" ? true : false;
};

export const remove = async () => {
  const answer = await new enquirer.Select({
    name: "ready",
    message: "确定删除服务器目录下所有文件",
    choices: ["确认", "取消"],
  })
    .run()
    .catch(console.error);

  return answer === "确认" ? true : false;
};

export const selectEnv = async envs => {
  const answer = await new enquirer.Select({
    name: "ready",
    message: "请选择环境",
    choices: envs.map(item => item.appName),
  })
    .run()
    .catch(console.error);

  return envs.find(item => item.appName === answer);
};

export default {
  connect,
  backup,
  remove,
  selectEnv,
  mkdirRemotePath,
};
