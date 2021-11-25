import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractTransaction, BigNumber } from "ethers";
import { IUSDC, MarketPlaceCore__factory } from "../../typechain";
import hre, { ethers } from "hardhat";
import { parseEther } from "ethers/lib/utils";

export const USDC_MILLIONAIRE_ADDRESS = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7";

export const impersonateAccount = async (address: string): Promise<SignerWithAddress> => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  await hre.network.provider.request({
    method: "hardhat_setCode",
    params: [address, "0x00"], // tranforming contract to EOA to be able to receive ETH
  });
  await hre.network.provider.request({
    method: "hardhat_setBalance",
    params: [address, ethers.utils.hexStripZeros(parseEther("1").toHexString())],
  });

  return ethers.getSigner(USDC_MILLIONAIRE_ADDRESS);
};

const {
  utils: { keccak256, toUtf8Bytes },
} = ethers;

const getOrderIdFromEvent = async (tx: Promise<ContractTransaction>, eventName: string) => {
  const receipt = await (await tx).wait();
  const iface = new ethers.utils.Interface(MarketPlaceCore__factory.abi);

  const logs = receipt.logs
    .map((l) => {
      try {
        return iface.parseLog(l);
      } catch (e) {}
    })
    .filter((l) => !!l);

  const [event] = logs;
  const { orderId } = event!.args!;
  return orderId;
};

export const OrderStatus = {
  PLACED: 0,
  CANCELED: 1,
  EXECUTED: 2,
};

export const getOrderIdFromOrderPlaced = async (tx: Promise<ContractTransaction>) =>
  getOrderIdFromEvent(tx, "OrderPlaced");
export const getOrderIdFromOrderCanceled = async (tx: Promise<ContractTransaction>) =>
  getOrderIdFromEvent(tx, "OrderCanceled");

export const signPermit = async ({
  usdc,
  params,
}: {
  usdc: IUSDC;
  params: { owner: SignerWithAddress; spender: string; value: BigNumber; deadline: BigNumber };
}) => {
  const domain = {
    name: await usdc.name(),
    version: await usdc.version(),
    chainId: 1,
    verifyingContract: usdc.address,
  };

  const type = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const { owner, spender, value, deadline } = params;

  const valueToSign = {
    owner: owner.address,
    spender,
    value,
    nonce: (await usdc.nonces(owner.address)) || 0,
    deadline,
  };

  const signature = await owner._signTypedData(domain, type, valueToSign);
  const { r, s, v } = ethers.utils.splitSignature(signature);
  return { r, s, v };
};
