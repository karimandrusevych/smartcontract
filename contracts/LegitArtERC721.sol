// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;
pragma abicoder v2; // required to accept structs as function parameters

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "./registry/IProxyRegistry.sol";

/// @title LegitArt NFT
contract LegitArtERC721 is ERC721URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    IProxyRegistry public proxyRegistry;
    mapping(uint256 => address) public creatorOf;

    constructor(IProxyRegistry _proxyRegistry)
        ERC721("Legit.Art ERC721", "LegitArt")
    {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        proxyRegistry = _proxyRegistry;
    }

    modifier onlyMinter() {
        require(
            hasRole(MINTER_ROLE, _msgSender()),
            "The caller is not a minter"
        );
        _;
    }

    /// @notice Mint a new NFT
    function _mintTo(
        address _creator,
        address _to,
        uint256 _tokenId,
        string memory _tokenURI
    ) internal {
        creatorOf[_tokenId] = _creator;
        _mint(_to, _tokenId);
        _setTokenURI(_tokenId, _tokenURI);
    }

    /// @notice Mint a new NFT
    /// @dev Should be called only by a minter (i.e. Marketplace contract)
    function mintTo(
        address _creator,
        address _to,
        uint256 _tokenId,
        string memory _tokenURI
    ) public onlyMinter {
        _mintTo(_creator, _to, _tokenId, _tokenURI);
    }

    /// @dev ERC165 support
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControl, ERC721)
        returns (bool)
    {
        return
            ERC721.supportsInterface(interfaceId) ||
            AccessControl.supportsInterface(interfaceId);
    }

    /**
     * Override isApprovedForAll to whitelist user's LegitArt proxy accounts to enable gas-less listings.
     */
    function isApprovedForAll(address owner, address operator)
        public
        view
        override
        returns (bool)
    {
        // Whitelist LegitArt proxy contract for easy trading.
        if (address(proxyRegistry.proxies(owner)) == operator) {
            return true;
        }

        return super.isApprovedForAll(owner, operator);
    }

    function mint(uint256 _tokenId, string memory _tokenURI) public {
        _mintTo(_msgSender(), _msgSender(), _tokenId, _tokenURI);
    }
}
