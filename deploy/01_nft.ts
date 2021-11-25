import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const LegitArtRegistry = "LegitArtRegistry";
const LegitArtERC721 = "LegitArtERC721";

const func: DeployFunction = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const legitArtRegistry = await get(LegitArtRegistry);

  await deploy(LegitArtERC721, {
    from: deployer,
    args: [legitArtRegistry.address],
    log: true,
  });
};

func.tags = [LegitArtERC721];
func.dependencies = [LegitArtRegistry];

export default func;
