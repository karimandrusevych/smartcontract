import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const LegitArtRegistry = "LegitArtRegistry";

const func: DeployFunction = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy(LegitArtRegistry, {
    from: deployer,
    args: [],
    log: true,
  });
};

func.tags = [LegitArtRegistry];

export default func;
