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
  MarketPlaceCore,
  MarketPlaceCoreMock__factory,
  IUSDC,
  IUSDC__factory,
} from "../typechain";
import { parseEther } from "ethers/lib/utils";
import {
  getOrderIdFromOrderPlaced,
  OrderStatus,
  USDC_MILLIONAIRE_ADDRESS,
  signPermit,
  impersonateAccount,
} from "./helpers";
import { MINTER_ROLE, Address } from "../helpers";
import { BigNumber } from "ethers";

const primaryFeePercentage = parseEther("0.10"); // 10%
const secondaryFeePercentage = parseEther("0.11"); // 11%
const royaltyFeePercentage = parseEther("0.12"); // 12%

describe("MarketPlaceCore", () => {
  let snapshotId: string;
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let registry: LegitArtRegistry;
  let erc721: LegitArtERC721;
  let marketPlace: MarketPlaceCore;
  let usdc: IUSDC;
  let feeBeneficiary: SignerWithAddress;
  let sellerProxy: AuthenticatedProxy;
  let buyerProxy: AuthenticatedProxy;

  const tokenId = 1;
  const price = BigNumber.from((1e6).toString());

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
    [owner, creator, seller, buyer, feeBeneficiary] = await ethers.getSigners();

    const usdcMillionaire = await impersonateAccount(USDC_MILLIONAIRE_ADDRESS);

    usdc = IUSDC__factory.connect(Address.mainnet.USDC, usdcMillionaire);
    await usdc.connect(usdcMillionaire).transfer(buyer.address, (100e6).toString());

    const LegitArtRegistryFactory = new LegitArtRegistry__factory(owner);
    registry = await LegitArtRegistryFactory.deploy();
    await registry.deployed();

    const LegitArtERC721Factory = new LegitArtERC721__factory(owner);
    erc721 = await LegitArtERC721Factory.deploy(registry.address);
    await erc721.deployed();

    const MarketPlaceFactory = new MarketPlaceCoreMock__factory(owner);
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

    await erc721.connect(creator).mint(tokenId, "");
    await erc721.connect(creator).transferFrom(creator.address, seller.address, tokenId);
    expect(await erc721.ownerOf(tokenId)).to.eq(seller.address);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  describe("placeOrder", () => {
    let orderId: string;

    // TODO: Move to a better test suite
    it("should transfer users's LegitNFT", async () => {
      const call = erc721.interface.encodeFunctionData("transferFrom", [seller.address, buyer.address, tokenId]);
      await sellerProxy.proxy(erc721.address, 0, call);
      expect(await erc721.ownerOf(tokenId)).to.eq(buyer.address);
    });

    it("should place an order", async () => {
      // when
      const call = marketPlace.interface.encodeFunctionData("placeOrder", [erc721.address, tokenId, price]);
      const tx = sellerProxy.proxy(marketPlace.address, 0, call);
      orderId = await getOrderIdFromOrderPlaced(tx);

      // then
      await expect(tx)
        .to.emit(marketPlace, "OrderPlaced")
        .withArgs(orderId, erc721.address, tokenId, seller.address, price);
      const order = await marketPlace.orders(orderId);
      expect(order.nftContract).to.eq(erc721.address);
      expect(order.tokenId).to.eq(tokenId);
      expect(order.seller).to.eq(seller.address);
      expect(order.buyer).to.eq(ethers.constants.AddressZero);
      expect(order.price).to.eq(price);
      expect(order.createdAt).to.eq((await ethers.provider.getBlock("latest")).timestamp);
      expect(order.status).to.eq(OrderStatus.PLACED);
      expect(await erc721.ownerOf(tokenId)).to.eq(marketPlace.address);
    });

    it("should revert if nftContract is null", async () => {
      const nftContract = ethers.constants.AddressZero;
      const call = marketPlace.interface.encodeFunctionData("placeOrder", [nftContract, tokenId, price]);
      const tx = sellerProxy.proxy(marketPlace.address, 0, call);
      await expect(tx).to.revertedWith("NFT contract can not be null");
    });

    it("should revert if token isn't exist", async () => {
      const invalidTokenId = 999;
      const call = marketPlace.interface.encodeFunctionData("placeOrder", [erc721.address, invalidTokenId, price]);
      const tx = sellerProxy.proxy(marketPlace.address, 0, call);
      await expect(tx).to.revertedWith("ERC721: operator query for nonexistent token");
    });

    it("should revert if isn't own the token", async () => {
      const call = marketPlace.interface.encodeFunctionData("placeOrder", [erc721.address, tokenId, price]);
      const tx = buyerProxy.proxy(marketPlace.address, 0, call);
      await expect(tx).to.revertedWith("ERC721: transfer caller is not owner nor approved");
    });
  });

  describe("when has a placed order", () => {
    let orderId: string;

    beforeEach(async () => {
      // when
      const call = marketPlace.interface.encodeFunctionData("placeOrder", [erc721.address, tokenId, price]);
      const tx = sellerProxy.proxy(marketPlace.address, 0, call);
      orderId = await getOrderIdFromOrderPlaced(tx);
    });

    describe("executeOrder", () => {
      it("should revert if order doesn't exist", async () => {
        const invalidOrderId = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
        const tx = marketPlace.connect(buyer).executeOrder(invalidOrderId);
        await expect(tx).to.revertedWith("Order does not exist");
      });

      it("should revert if order was executed already", async () => {
        // given
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);

        const call = marketPlace.interface.encodeFunctionData("executeOrder", [orderId]);
        await buyerProxy.proxy(marketPlace.address, 0, call);

        // when
        const tx = buyerProxy.proxy(marketPlace.address, 0, call);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should revert if order was canceled", async () => {
        // given
        // await marketPlace.connect(seller).cancelOrder(orderId);
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        await sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // when
        // const tx = marketPlace.connect(buyer).executeOrder(orderId);
        const executeCall = marketPlace.interface.encodeFunctionData("executeOrder", [orderId]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, executeCall);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should execute an order with just one transaction", async () => {
        // given
        const creatorBalanceBefore = await usdc.balanceOf(creator.address);
        const sellerBalanceBefore = await usdc.balanceOf(seller.address);
        const feeBeneficiaryBalanceBefore = await usdc.balanceOf(feeBeneficiary.address);
        expect(feeBeneficiaryBalanceBefore).to.eq(0);
        expect(await erc721.ownerOf(tokenId)).to.eq(marketPlace.address);

        const params: { owner: SignerWithAddress; spender: string; value: BigNumber; deadline: BigNumber } = {
          owner: buyer,
          spender: marketPlace.address,
          value: ethers.constants.MaxUint256,
          deadline: ethers.constants.MaxUint256,
        };
        const { r, s, v } = await signPermit({ usdc, params });

        const permitCall = usdc.interface.encodeFunctionData("permit", [
          params.owner.address,
          params.spender,
          params.value,
          params.deadline,
          v,
          r,
          s,
        ]);

        // when
        const expectedRoyaltyFee = price.mul(royaltyFeePercentage).div(`${1e18}`);
        const expectedProtocolFee = price.mul(secondaryFeePercentage).div(`${1e18}`);
        const executeCall = marketPlace.interface.encodeFunctionData("executeOrder", [orderId]);

        const tx = buyerProxy.multi([usdc.address, marketPlace.address], [0, 0], [permitCall, executeCall]);

        // then
        await expect(tx)
          .to.emit(marketPlace, "OrderExecuted")
          .withArgs(orderId, buyer.address, expectedProtocolFee, expectedRoyaltyFee);
        const sellerBalanceAfter = await usdc.balanceOf(seller.address);
        const creatorBalanceAfter = await usdc.balanceOf(creator.address);
        const feeBeneficiaryBalanceAfter = await usdc.balanceOf(feeBeneficiary.address);
        expect(feeBeneficiaryBalanceAfter).to.eq(expectedProtocolFee);
        expect(sellerBalanceAfter.sub(sellerBalanceBefore)).to.eq(
          price.sub(expectedProtocolFee).sub(expectedRoyaltyFee)
        );
        expect(creatorBalanceAfter.sub(creatorBalanceBefore)).to.eq(expectedRoyaltyFee);
        expect(await erc721.ownerOf(tokenId)).to.eq(buyer.address);
        const order = await marketPlace.orders(orderId);
        expect(order.status).to.eq(OrderStatus.EXECUTED);
        expect(order.buyer).to.eq(buyer.address);
      });
    });

    describe("cancelOrder", () => {
      it("should revert if order was canceled", async () => {
        // given
        const cancelCall1 = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        await sellerProxy.proxy(marketPlace.address, 0, cancelCall1);

        // when
        const cancelCall2 = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall2);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should revert if order was executed", async () => {
        // given
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);
        const executeCall1 = marketPlace.interface.encodeFunctionData("executeOrder", [orderId]);
        await buyerProxy.proxy(marketPlace.address, 0, executeCall1);

        // when
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should revert if caller isn't seller", async () => {
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, cancelCall);
        await expect(tx).to.revertedWith("Only seller can cancel an order");
      });

      it("should revert order doesn't exist", async () => {
        const invalidOrderId = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
        const tx = marketPlace.connect(seller).cancelOrder(invalidOrderId);
        await expect(tx).to.revertedWith("Order does not exist");
      });

      it("should cancel an order", async () => {
        // given
        expect(await erc721.ownerOf(tokenId)).to.eq(marketPlace.address);

        // when
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // then
        await expect(tx).to.emit(marketPlace, "OrderCanceled").withArgs(orderId);
        expect(await erc721.ownerOf(tokenId)).to.eq(seller.address);
        const order = await marketPlace.orders(orderId);
        expect(order.status).to.eq(OrderStatus.CANCELED);
      });
    });

    describe("updateOrder", () => {
      const newPrice = price.mul("2");

      it("should revert if caller isn't seller", async () => {
        const call = marketPlace.interface.encodeFunctionData("updateOrder", [orderId, newPrice]);
        const tx = buyerProxy.proxy(marketPlace.address, 0, call);
        await expect(tx).to.revertedWith("Only seller can update an order");
      });

      it("should revert order was executed", async () => {
        // given
        await usdc.connect(buyer).approve(marketPlace.address, ethers.constants.MaxUint256);
        const executeCall = marketPlace.interface.encodeFunctionData("executeOrder", [orderId]);
        await buyerProxy.proxy(marketPlace.address, 0, executeCall);

        // when
        const updateCall = marketPlace.interface.encodeFunctionData("updateOrder", [orderId, newPrice]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, updateCall);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should revert if order was canceled", async () => {
        // given
        const cancelCall = marketPlace.interface.encodeFunctionData("cancelOrder", [orderId]);
        await sellerProxy.proxy(marketPlace.address, 0, cancelCall);

        // when
        const updateCall = marketPlace.interface.encodeFunctionData("updateOrder", [orderId, newPrice]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, updateCall);
        await expect(tx).to.revertedWith("Order status is not valid");
      });

      it("should revert order doesn't exist", async () => {
        const invalidOrderId = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
        const tx = marketPlace.connect(seller).updateOrder(invalidOrderId, newPrice);
        await expect(tx).to.revertedWith("Order does not exist");
      });

      it("should update an order", async () => {
        // when
        const updateCall = marketPlace.interface.encodeFunctionData("updateOrder", [orderId, newPrice]);
        const tx = sellerProxy.proxy(marketPlace.address, 0, updateCall);

        // then
        await expect(tx).to.emit(marketPlace, "OrderUpdated").withArgs(orderId, newPrice);
        const order = await marketPlace.orders(orderId);
        expect(order.status).to.eq(OrderStatus.PLACED);
        expect(order.price).to.eq(newPrice);
      });
    });
  });

  describe("updateFeeBeneficiary", () => {
    it("should revert if not owner", async () => {
      const tx = marketPlace.connect(seller).updateFeeBeneficiary(ethers.constants.AddressZero);
      await expect(tx).to.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if address is null", async () => {
      const tx = marketPlace.updateFeeBeneficiary(ethers.constants.AddressZero);
      await expect(tx).to.revertedWith("Beneficiary is invalid");
    });

    it("should revert if address is the same than old", async () => {
      const tx = marketPlace.updateFeeBeneficiary(feeBeneficiary.address);
      await expect(tx).to.revertedWith("Beneficiary is the same as current");
    });

    it("should update fee beneficiary", async () => {
      const tx = marketPlace.updateFeeBeneficiary(owner.address);
      await expect(tx).to.emit(marketPlace, "FeeBeneficiaryUpdated").withArgs(feeBeneficiary.address, owner.address);
    });
  });

  describe("updatePrimaryFeePercentage", () => {
    it("should revert if not owner", async () => {
      const tx = marketPlace.connect(seller).updatePrimaryFeePercentage(0);
      await expect(tx).to.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if fee > 100%", async () => {
      const invalidFee = parseEther("1").add("1");
      const tx = marketPlace.updatePrimaryFeePercentage(invalidFee);
      await expect(tx).to.revertedWith("Fee is greater than 100%");
    });

    it("should revert if fee is the same than old", async () => {
      const tx = marketPlace.updatePrimaryFeePercentage(primaryFeePercentage);
      await expect(tx).to.revertedWith("Fee is the same as current");
    });

    it("should update fee percentage", async () => {
      const newFee = primaryFeePercentage.mul("2");
      const tx = marketPlace.updatePrimaryFeePercentage(newFee);
      await expect(tx).to.emit(marketPlace, "PrimaryFeePercentageUpdated").withArgs(primaryFeePercentage, newFee);
    });
  });

  describe("updateSecondaryFeePercentage", () => {
    it("should revert if not owner", async () => {
      const tx = marketPlace.connect(seller).updateSecondaryFeePercentage(0);
      await expect(tx).to.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if fee > 100%", async () => {
      const invalidFee = parseEther("1").add("1");
      const tx = marketPlace.updateSecondaryFeePercentage(invalidFee);
      await expect(tx).to.revertedWith("Fee is greater than 100%");
    });

    it("should revert if fee is the same than old", async () => {
      const tx = marketPlace.updateSecondaryFeePercentage(secondaryFeePercentage);
      await expect(tx).to.revertedWith("Fee is the same as current");
    });

    it("should update fee percentage", async () => {
      const newFee = secondaryFeePercentage.mul("2");
      const tx = marketPlace.updateSecondaryFeePercentage(newFee);
      await expect(tx).to.emit(marketPlace, "SecondaryFeePercentageUpdated").withArgs(secondaryFeePercentage, newFee);
    });
  });

  describe("updateRoyaltyFeePercentage", () => {
    it("should revert if not owner", async () => {
      const tx = marketPlace.connect(seller).updateRoyaltyFeePercentage(0);
      await expect(tx).to.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if fee > 100%", async () => {
      const invalidFee = parseEther("1").add("1");
      const tx = marketPlace.updateRoyaltyFeePercentage(invalidFee);
      await expect(tx).to.revertedWith("Fee is greater than 100%");
    });

    it("should revert if fee is the same than old", async () => {
      const tx = marketPlace.updateRoyaltyFeePercentage(royaltyFeePercentage);
      await expect(tx).to.revertedWith("Fee is the same as current");
    });

    it("should update fee percentage", async () => {
      const newFee = royaltyFeePercentage.mul("2");
      const tx = marketPlace.updateRoyaltyFeePercentage(newFee);
      await expect(tx).to.emit(marketPlace, "RoyaltyFeePercentageUpdated").withArgs(royaltyFeePercentage, newFee);
    });
  });
});
