// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface ILegitArtERC721 {
    function mintTo(
        address creator,
        address to,
        uint256 tokenId,
        string memory tokenURI
    ) external;

    function creatorOf(uint256 tokenId) external returns (address creator);
}
