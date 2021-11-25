// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;
pragma abicoder v2; // required to accept structs as function parameters

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MarketPlaceCore.sol";
import "./interfaces/ILegitArtERC721.sol";

/// @title LegitArt Marketplace
contract MarketPlace is MarketPlaceCore, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Represents an un-minted NFT, which has not yet been recorded into the blockchain. A signed voucher can be redeemed for a real NFT using the redeem function.
    struct NFTVoucher {
        /// @notice The id of the token to be redeemed. Must be unique - if another token with this ID already exists, the redeem function will revert.
        uint256 tokenId;
        /// @notice The price (in wei) that the NFT creator is willing to accept for the initial sale of this NFT.
        uint256 price;
        /// @notice The metadata URI to associate with this token.
        string uri;
        /// @notice The sign timestamp (used for nonce purpose)
        uint256 createdAt;
        /// @notice The EIP-712 signature of all other fields in the NFTVoucher struct. For a voucher to be valid, it must be signed by an account with the MINTER_ROLE.
        bytes signature;
    }

    string private constant SIGNING_DOMAIN = "LegitArtERC721";
    string private constant SIGNATURE_VERSION = "1";

    constructor(
        IERC20 _usdc,
        ILegitArtERC721 _legitArtNFT,
        address _feeBeneficiary,
        uint256 _primaryFeePercentage,
        uint256 _secondaryFeePercentage,
        uint256 _royaltyFeePercentage
    )
        MarketPlaceCore(
            _usdc,
            _legitArtNFT,
            _feeBeneficiary,
            _primaryFeePercentage,
            _secondaryFeePercentage,
            _royaltyFeePercentage
        )
        EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION)
    {}

    /// @notice Order execution by supporting lazy-minting
    /// @dev A voucher signed by the seller is used to mint the NFT, place and execute an order
    /// in the same call
    function executeLazy(NFTVoucher calldata _voucher) external nonReentrant {
        address seller = _verify(_voucher);

        address buyer = _getUserFromMsgSender();

        address nftContract = address(legitArtNFT);

        bytes32 orderId = _getOrderIdFromFields(
            nftContract,
            _voucher.tokenId,
            _voucher.price,
            _voucher.createdAt,
            seller
        );

        require(
            !_orderExists(orderId),
            "Is not possible to execute a stored order"
        );

        _storeOrder(
            nftContract,
            _voucher.tokenId,
            _voucher.price,
            _voucher.createdAt,
            seller,
            OrderStatus.EXECUTED
        );

        Order storage order = orders[orderId];
        order.buyer = buyer;

        (
            uint256 _protocolFeeCollected,
            uint256 _royaltyFeeCollected
        ) = _processOrderPayment(order, primaryFeePercentage, 0);

        legitArtNFT.mintTo(seller, order.buyer, _voucher.tokenId, _voucher.uri);

        emit OrderPlaced(
            orderId,
            nftContract,
            _voucher.tokenId,
            seller,
            _voucher.price
        );
        emit OrderExecuted(
            orderId,
            order.buyer,
            _protocolFeeCollected,
            _royaltyFeeCollected
        );
    }

    /// @notice Cancel an lazy-minting order
    function cancelLazy(NFTVoucher calldata _voucher) external {
        address seller = _verify(_voucher);
        require(
            _getUserFromMsgSender() == seller,
            "Only seller can cancel an order"
        );

        address nftContract = address(legitArtNFT);

        bytes32 orderId = _getOrderIdFromFields(
            nftContract,
            _voucher.tokenId,
            _voucher.price,
            _voucher.createdAt,
            seller
        );

        require(
            !_orderExists(orderId),
            "Is not possible to cancel a stored order"
        );

        _storeOrder(
            nftContract,
            _voucher.tokenId,
            _voucher.price,
            _voucher.createdAt,
            seller,
            OrderStatus.CANCELED
        );

        emit OrderPlaced(
            orderId,
            nftContract,
            _voucher.tokenId,
            seller,
            _voucher.price
        );
        emit OrderCanceled(orderId);
    }

    /// @notice Returns a hash of the given NFTVoucher, prepared using EIP712 typed data hashing rules.
    function _hash(NFTVoucher calldata _voucher)
        internal
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        keccak256(
                            "NFTVoucher(uint256 tokenId,uint256 price,string uri,uint256 createdAt)"
                        ),
                        _voucher.tokenId,
                        _voucher.price,
                        keccak256(bytes(_voucher.uri)),
                        _voucher.createdAt
                    )
                )
            );
    }

    /// @notice Verifies the signature for a given NFTVoucher, returning the address of the signer.
    /// @dev Will revert if the signature is invalid. Does not verify that the signer is authorized to mint NFTs.
    function _verify(NFTVoucher calldata _voucher)
        internal
        view
        returns (address signer)
    {
        bytes32 digest = _hash(_voucher);
        signer = ECDSA.recover(digest, _voucher.signature);
    }
}
