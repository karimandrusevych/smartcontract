// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;
pragma abicoder v2; // required to accept structs as function parameters

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILegitArtERC721.sol";
import "./registry/AuthenticatedProxy.sol";

/// @title LegitArt Marketplace
abstract contract MarketPlaceCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum OrderStatus {
        PLACED,
        CANCELED,
        EXECUTED
    }

    struct Order {
        address nftContract;
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 price;
        uint256 createdAt;
        OrderStatus status;
    }

    mapping(bytes32 => Order) public orders;
    IERC20 public immutable usdc;
    ILegitArtERC721 public legitArtNFT;
    address public feeBeneficiary;
    uint256 public primaryFeePercentage; // Use 1e18 for 100%
    uint256 public secondaryFeePercentage; // Use 1e18 for 100%
    uint256 public royaltyFeePercentage; // Use 1e18 for 100%

    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed nftContract,
        uint256 indexed tokenId,
        address seller,
        uint256 price
    );
    event OrderExecuted(
        bytes32 indexed orderId,
        address buyer,
        uint256 protocolFeeCollected,
        uint256 royaltyFeeCollected
    );
    event OrderCanceled(bytes32 indexed orderId);
    event OrderUpdated(bytes32 indexed orderId, uint256 newPrice);
    event FeeBeneficiaryUpdated(
        address indexed oldFeeBeneficiary,
        address indexed newFeeBeneficiary
    );
    event PrimaryFeePercentageUpdated(
        uint256 oldPrimaryFeePercentage,
        uint256 newPrimaryFeePercentage
    );
    event SecondaryFeePercentageUpdated(
        uint256 oldSecondaryFeePercentage,
        uint256 newSecondaryFeePercentage
    );
    event RoyaltyFeePercentageUpdated(
        uint256 oldRoyaltyFeePercentage,
        uint256 newRoyaltyFeePercentage
    );

    constructor(
        IERC20 _usdc,
        ILegitArtERC721 _legitArtNFT,
        address _feeBeneficiary,
        uint256 _primaryFeePercentage,
        uint256 _secondaryFeePercentage,
        uint256 _royaltyFeePercentage
    ) {
        usdc = _usdc;
        legitArtNFT = _legitArtNFT;
        feeBeneficiary = _feeBeneficiary;
        primaryFeePercentage = _primaryFeePercentage;
        secondaryFeePercentage = _secondaryFeePercentage;
        royaltyFeePercentage = _royaltyFeePercentage;
    }

    /// @notice Store a new order
    function _storeOrder(
        address _nftContract,
        uint256 _tokenId,
        uint256 _price,
        uint256 _createdAt,
        address _seller,
        OrderStatus _status
    ) internal returns (bytes32 orderId) {
        orderId = _getOrderIdFromFields(
            _nftContract,
            _tokenId,
            _price,
            _createdAt,
            _seller
        );

        require(!_orderExists(orderId), "Order stored already");

        Order memory order = Order({
            nftContract: _nftContract,
            tokenId: _tokenId,
            seller: _seller,
            buyer: address(0),
            price: _price,
            createdAt: _createdAt,
            status: _status
        });

        orders[orderId] = order;
    }

    function _bytesToAddress(bytes memory bys)
        private
        pure
        returns (address addr)
    {
        assembly {
            addr := mload(add(bys, 32))
        }
    }

    /// @notice Place an item for sale on the marketplace
    function _placeOrder(
        address _nftContract,
        uint256 _tokenId,
        uint256 _price,
        address _seller
    ) internal returns (bytes32 orderId) {
        require(_nftContract != address(0), "NFT contract can not be null");

        orderId = _storeOrder(
            _nftContract,
            _tokenId,
            _price,
            block.timestamp,
            _seller,
            OrderStatus.PLACED
        );

        // Transfer user's NFT by calling his proxy
        bytes memory call = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            _seller,
            address(this),
            _tokenId
        );
        _getProxyFromMsgSender().proxy(
            _nftContract,
            AuthenticatedProxy.HowToCall.Call,
            call
        );

        emit OrderPlaced(orderId, _nftContract, _tokenId, _seller, _price);
    }

    function _getProxyFromMsgSender()
        internal
        view
        returns (AuthenticatedProxy)
    {
        require(Address.isContract(_msgSender()), "The caller is not a proxy");
        return AuthenticatedProxy(_msgSender());
    }

    function _getUserFromMsgSender() internal view returns (address) {
        return _getProxyFromMsgSender().user();
    }

    /// @notice Place an item for sale on the marketplace
    function placeOrder(
        address _nftContract,
        uint256 _tokenId,
        uint256 _price
    ) external nonReentrant returns (bytes32 orderId) {
        address seller = _getUserFromMsgSender();
        orderId = _placeOrder(_nftContract, _tokenId, _price, seller);
    }

    /// @notice Check if an order exists
    function _orderExists(bytes32 _orderId) internal view returns (bool) {
        return orders[_orderId].nftContract != address(0);
    }

    function _processOrderPayment(
        Order memory order,
        uint256 _protocolFeePercentage,
        uint256 _royaltyFeePercentage
    )
        internal
        returns (uint256 _protocolFeeCollected, uint256 _royaltyFeeCollected)
    {
        _protocolFeeCollected = (order.price * _protocolFeePercentage) / 1e18;
        _royaltyFeeCollected = (order.price * _royaltyFeePercentage) / 1e18;

        // Seller payment
        usdc.safeTransferFrom(
            order.buyer,
            order.seller,
            order.price - _protocolFeeCollected - _royaltyFeeCollected
        );

        // Protocol fee payment
        usdc.safeTransferFrom(
            order.buyer,
            feeBeneficiary,
            _protocolFeeCollected
        );

        // Royalty fee payment
        if (_royaltyFeeCollected > 0) {
            usdc.safeTransferFrom(
                order.buyer,
                legitArtNFT.creatorOf(order.tokenId),
                _royaltyFeeCollected
            );
        }
    }

    /// @notice Execute a placed order
    function _executeOrder(bytes32 _orderId) internal {
        require(_orderExists(_orderId), "Order does not exist");

        Order storage order = orders[_orderId];

        require(
            order.status == OrderStatus.PLACED,
            "Order status is not valid"
        );

        order.buyer = _getUserFromMsgSender();
        order.status = OrderStatus.EXECUTED;

        (
            uint256 _protocolFeeCollected,
            uint256 _royaltyFeeCollected
        ) = _processOrderPayment(
                order,
                secondaryFeePercentage,
                royaltyFeePercentage
            );

        IERC721(order.nftContract).transferFrom(
            address(this),
            order.buyer,
            order.tokenId
        );

        emit OrderExecuted(
            _orderId,
            order.buyer,
            _protocolFeeCollected,
            _royaltyFeeCollected
        );
    }

    /// @notice Execute a placed order
    function executeOrder(bytes32 _orderId) external nonReentrant {
        _executeOrder(_orderId);
    }

    /// @notice Cancel a placed order
    function cancelOrder(bytes32 _orderId) external nonReentrant {
        require(_orderExists(_orderId), "Order does not exist");

        Order storage order = orders[_orderId];

        require(
            _getUserFromMsgSender() == order.seller,
            "Only seller can cancel an order"
        );
        require(
            order.status == OrderStatus.PLACED,
            "Order status is not valid"
        );

        order.status = OrderStatus.CANCELED;

        IERC721(order.nftContract).transferFrom(
            address(this),
            order.seller,
            order.tokenId
        );

        emit OrderCanceled(_orderId);
    }

    function updateOrder(bytes32 _orderId, uint256 _newPrice)
        external
        nonReentrant
    {
        require(_orderExists(_orderId), "Order does not exist");

        Order storage order = orders[_orderId];

        require(
            _getUserFromMsgSender() == order.seller,
            "Only seller can update an order"
        );
        require(
            order.status == OrderStatus.PLACED,
            "Order status is not valid"
        );

        order.price = _newPrice;

        emit OrderUpdated(_orderId, _newPrice);
    }

    /// @notice Generate orderId for a given order by hashing the key params
    function _getOrderIdFromFields(
        address _nftContract,
        uint256 _tokenId,
        uint256 _price,
        uint256 _createdAt,
        address _seller
    ) internal pure returns (bytes32 orderId) {
        orderId = keccak256(
            abi.encode(_nftContract, _tokenId, _price, _createdAt, _seller)
        );
    }

    function updateFeeBeneficiary(address _newFeeBenenficiary)
        public
        onlyOwner
    {
        require(_newFeeBenenficiary != address(0), "Beneficiary is invalid");
        require(
            _newFeeBenenficiary != feeBeneficiary,
            "Beneficiary is the same as current"
        );
        emit FeeBeneficiaryUpdated(feeBeneficiary, _newFeeBenenficiary);
        feeBeneficiary = _newFeeBenenficiary;
    }

    function updatePrimaryFeePercentage(uint256 _newPrimaryFeePercentage)
        public
        onlyOwner
    {
        require(_newPrimaryFeePercentage <= 1e18, "Fee is greater than 100%");
        require(
            _newPrimaryFeePercentage != primaryFeePercentage,
            "Fee is the same as current"
        );
        emit PrimaryFeePercentageUpdated(
            primaryFeePercentage,
            _newPrimaryFeePercentage
        );
        primaryFeePercentage = _newPrimaryFeePercentage;
    }

    function updateSecondaryFeePercentage(uint256 _newSecondaryFeePercentage)
        public
        onlyOwner
    {
        require(_newSecondaryFeePercentage <= 1e18, "Fee is greater than 100%");
        require(
            _newSecondaryFeePercentage != secondaryFeePercentage,
            "Fee is the same as current"
        );
        emit SecondaryFeePercentageUpdated(
            secondaryFeePercentage,
            _newSecondaryFeePercentage
        );
        secondaryFeePercentage = _newSecondaryFeePercentage;
    }

    function updateRoyaltyFeePercentage(uint256 _newRoyaltyFeePercentage)
        public
        onlyOwner
    {
        require(_newRoyaltyFeePercentage <= 1e18, "Fee is greater than 100%");
        require(
            _newRoyaltyFeePercentage != royaltyFeePercentage,
            "Fee is the same as current"
        );
        emit RoyaltyFeePercentageUpdated(
            royaltyFeePercentage,
            _newRoyaltyFeePercentage
        );
        royaltyFeePercentage = _newRoyaltyFeePercentage;
    }
}
