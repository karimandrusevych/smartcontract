import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { LegitArtERC721, LegitArtERC721__factory } from "../typechain";
import { MINTER_ROLE } from "../helpers";

describe("LegitArtERC721", () => {
  let erc721: LegitArtERC721;
  let wallet: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  beforeEach(async () => {
    [wallet, alice, bob] = await ethers.getSigners();
    const LegitArtERC721Factory = new LegitArtERC721__factory(wallet);
    // TODO
    const registryAddress = ethers.constants.AddressZero;
    erc721 = await LegitArtERC721Factory.deploy(registryAddress);
    await erc721.deployed();
  });

  describe("mintTo", () => {
    it("should revert if caller isn't a minter", async () => {
      const tx = erc721.connect(alice).mintTo(alice.address, bob.address, 1, "");
      await expect(tx).to.revertedWith("x");
    });

    it("should mint", async () => {
      // given
      expect(await erc721.balanceOf(wallet.address)).to.eq(0);

      // when
      await erc721.grantRole(MINTER_ROLE, alice.address);
      await erc721.connect(alice).mintTo(alice.address, wallet.address, 1, "");

      // then
      expect(await erc721.creatorOf(1)).to.eq(alice.address);
      expect(await erc721.balanceOf(wallet.address)).to.eq(1);
    });
  });
});
