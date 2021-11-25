import hre, { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  AuthenticatedProxy,
  AuthenticatedProxy__factory,
  LegitArtERC721,
  LegitArtERC721__factory,
  LegitArtRegistry,
  LegitArtRegistry__factory,
  MarketPlace,
  MarketPlace__factory,
  IUSDC,
  IUSDC__factory,
} from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { NFTVoucher, NFTVoucherFactory } from "./helpers/NFTVoucherFactory";
import {
  getOrderIdFromOrderPlaced,
  getOrderIdFromOrderCanceled,
  OrderStatus,
  USDC_MILLIONAIRE_ADDRESS,
  impersonateAccount,
} from "./helpers";
import { MINTER_ROLE, Address } from "../helpers";
import { BigNumber } from "ethers";

const primaryFeePercentage = parseEther("0.10"); // 10%
const secondaryFeePercentage = parseEther("0.11"); // 11%
const royaltyFeePercentage = parseEther("0.12"); // 12%

describe("MarketPlace", () => {
  let snapshotId: string;
  let owner: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let feeBeneficiary: SignerWithAddress;
  let erc721: LegitArtERC721;
  let marketPlace: MarketPlace;
  let usdc: IUSDC;
  let registry: LegitArtRegistry;
  let sellerProxy: AuthenticatedProxy;
  let buyerProxy: AuthenticatedProxy;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
    [owner, seller, buyer, feeBeneficiary] = await ethers.getSigners();

    const usdcMillionaire = await impersonateAccount(USDC_MILLIONAIRE_ADDRESS);

    usdc = IUSDC__factory.connect(Address.mainnet.USDC, usdcMillionaire);
    await usdc.transfer(buyer.address, (100e6).toString());

    const LegitArtRegistryFactory = new LegitArtRegistry__factory(owner);
    registry = await LegitArtRegistryFactory.deploy();
    await registry.deployed();

    const LegitArtERC721Factory = new LegitArtERC721__factory(owner);
    erc721 = await LegitArtERC721Factory.deploy(registry.address);
    await erc721.deployed();

    const MarketPlaceFactory = new MarketPlace__factory(owner);

    marketPlace = await MarketPlaceFactory.deploy(
      usdc.address,
      erc721.address,
      feeBeneficiary.address,
      primaryFeePercentage,
      secondaryFeePercentage,
      royaltyFeePercentage
    );
    await marketPlace.deployed();

    await erc721.grantRole(MINTER_ROLE, marketPlace.address);

    await registry.grantInitialAuthentication(marketPlace.address);

    await registry.connect(seller).registerProxy();
    const sellerProxyAddress = await registry.proxies(seller.address);
    sellerProxy = AuthenticatedProxy__factory.connect(sellerProxyAddress, seller);

    await registry.connect(buyer).registerProxy();
    const buyerProxyAddress = await registry.proxies(buyer.address);
    buyerProxy = AuthenticatedProxy__factory.connect(buyerProxyAddress, buyer);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  describe("when a voucher is created", () => {
    const tokenId = 1;
    const price = BigNumber.from((1e6).toString());
    let voucher: NFTVoucher;
    let orderId: string;

    beforeEach(async () => {
      const voucherFactory = new NFTVoucherFactory({ contract: marketPlace, signer: seller });
      voucher = await voucherFactory.createVoucher(
        tokenId,
        "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        price
      );

      await erc721.connect(seller).setApprovalForAll(marketPlace.address, true);
    });

    describe("executeLazy", () => {
      it("buyer should execute an order using voucher", async () => {
        // given
        const sellerBalanceBefore = await usdc.balanceOf(seller.address);
        const feeBeneficiaryBalanceBefore = await usdc.balanceOf(feeBeneficiary.address);
        expect(feeBeneficiaryBalanceBefore).to.eq(0);
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);

        // when
        const expectedRoyaltyFee = "0"; // no royalty when selling for the 1st time
        const expectedProtocolFee = price.mul(primaryFeePercentage).div(`${1e18}`);
        const call = marketPlace.interface.encodeFunctionData("executeLazy", [voucher]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, call);

        orderId = await getOrderIdFromOrderPlaced(tx);

        // then
        await expect(tx)
          .to.emit(marketPlace, "OrderPlaced")
          .withArgs(orderId, erc721.address, tokenId, seller.address, price);

        await expect(tx)
          .to.emit(marketPlace, "OrderExecuted")
          .withArgs(orderId, buyer.address, expectedProtocolFee, expectedRoyaltyFee);

        const feeBeneficiaryBalanceAfter = await usdc.balanceOf(feeBeneficiary.address);
        expect(feeBeneficiaryBalanceAfter).to.eq(expectedProtocolFee);
        const sellerBalanceAfter = await usdc.balanceOf(seller.address);
        expect(sellerBalanceAfter.sub(sellerBalanceBefore)).to.eq(
          price.sub(expectedProtocolFee).sub(expectedRoyaltyFee)
        );
        expect(await erc721.ownerOf(tokenId)).to.eq(buyer.address);

        const order = await marketPlace.orders(orderId);
        expect(order.nftContract).to.eq(erc721.address);
        expect(order.tokenId).to.eq(tokenId);
        expect(order.seller).to.eq(seller.address);
        expect(order.buyer).to.eq(buyer.address);
        expect(order.price).to.eq(voucher.price);
        expect(order.createdAt).to.eq(voucher.createdAt);
        expect(order.status).to.eq(OrderStatus.EXECUTED);
      });

      it("should revert if using same voucher twice", async () => {
        // given
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);
        const call1 = marketPlace.interface.encodeFunctionData("executeLazy", [voucher]);
        await buyerProxy.proxy(marketPlace.address, 0, call1);

        // when
        const call2 = marketPlace.interface.encodeFunctionData("executeLazy", [voucher]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, call2);

        // then
        await expect(tx).to.revertedWith("Is not possible to execute a stored order");
      });

      it("should rever if order was canceled", async () => {
        // given
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelLazy", [voucher]);
        await sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // when
        const executeCall = marketPlace.interface.encodeFunctionData("executeLazy", [voucher]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, executeCall);

        // then
        await expect(tx).to.revertedWith("Is not possible to execute a stored order");
      });
    });

    describe("cancelLazy", () => {
      it("seller should cancel an order using voucher", async () => {
        // when
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelLazy", [voucher]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall);
        orderId = await getOrderIdFromOrderCanceled(tx);

        // then
        await expect(tx)
          .to.emit(marketPlace, "OrderPlaced")
          .withArgs(orderId, erc721.address, tokenId, seller.address, price);
        await expect(tx).to.emit(marketPlace, "OrderCanceled").withArgs(orderId);

        const order = await marketPlace.orders(orderId);
        expect(order.nftContract).to.eq(erc721.address);
        expect(order.tokenId).to.eq(tokenId);
        expect(order.seller).to.eq(seller.address);
        expect(order.buyer).to.eq(ethers.constants.AddressZero);
        expect(order.price).to.eq(voucher.price);
        expect(order.createdAt).to.eq(voucher.createdAt);
        expect(order.status).to.eq(OrderStatus.CANCELED);
      });

      it("should revert if order was executed", async () => {
        // given
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);
        const executeCall = marketPlace.interface.encodeFunctionData("executeLazy", [voucher]);
        await buyerProxy.proxy(marketPlace.address, 0, executeCall);

        // when
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelLazy", [voucher]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // then
        await expect(tx).to.revertedWith("Is not possible to cancel a stored order");
      });

      it("should revert if order was canceled already", async () => {
        // given
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelLazy", [voucher]);
        await sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // when
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // then
        await expect(tx).to.revertedWith("Is not possible to cancel a stored order");
      });

      it("should revert if caller isn't seller", async () => {
        // when
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelLazy", [voucher]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, cancelCall);

        // then
        await expect(tx).to.revertedWith("Only seller can cancel an order");
      });
    });
  });
});
