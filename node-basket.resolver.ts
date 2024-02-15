import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CacheControlInterceptor } from '../util/cacheControl.interceptor';
import {
  ContextType,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import {
  extractAppVersionFromContext,
  extractAuthTokenFromContext,
} from '../user/helper/auth.helper';
import {
  BasketForCheckoutModel,
  BasketItemInputModel,
  BasketStoreExpansionModel,
  BasketWithPricesModel,
  UpdateBasketItemModel,
} from './models/basket.model';
import { BasketService } from './basket.service';
import { ShopifyService } from '../shopify/shopify.service';
import { UserServiceV2 } from '../user/vendor/user.service';
import { PointsService } from '../points/points.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Locale } from '../util';

@Resolver((of) => BasketStoreExpansionModel)
@UseInterceptors(CacheControlInterceptor)
export class BasketResolver {
  constructor(
    @InjectPinoLogger(BasketResolver.name)
    private readonly logger: PinoLogger,
    private readonly basketService: BasketService,
    private readonly shopifyService: ShopifyService,
    private readonly userService: UserServiceV2,
    private readonly pointsService: PointsService,
  ) {}

  @Query(() => BasketStoreExpansionModel, {
    description:
      'Retrieving the basket information for the user, ' +
      'using the deviceID for an anonymous basket, ' +
      'using userId instead of accessToken for an authorized basket - performance optimization',
  })
  public async basketV3(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({
      name: 'userId',
      nullable: true,
      description:
        'This is shopifyId (decoded from Base64 format) getting from payload. This will be overwrite if send together with accessToken',
    })
    shopifyId: string,
    @Args({ name: 'storeCode', nullable: true }) storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketStoreExpansionModel> {
    let userMakroId = '';
    let userId: string;
    const authToken = extractAuthTokenFromContext(context);
    const appVersion = extractAppVersionFromContext(context);
    if (authToken && !deviceId) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims.shopifyId;
      userId = claims.userId;
    }

    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    if (!deviceId && !shopifyId) {
      throw new HttpException(
        'Neither devideId nor userId of the associated user were provided or both of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (deviceId && shopifyId) {
      throw new HttpException(
        'Both deviceId and userId were provided. Should provide 1 only, for either anonymous or logged-in basket',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.basketService.getBasket({
      deviceId: deviceId || null,
      shopifyId: shopifyId || null,
      storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      appVersion,
      userMakroId,
      userId: userId || null,
      lang,
    });
  }

  @Query(() => BasketWithPricesModel, {
    description:
      'Retrieving the basket information for the user, ' +
      'using the deviceID for an anonymous basket, ' +
      'using shopifyId instead of accessToken for an authorized basket - performance optimization, ' +
      'return prices together with the basket and error from voucher service',
  })
  public async basketV4(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({ name: 'userId', nullable: true }) shopifyId: string,
    @Args({ name: 'storeCode', nullable: true }) storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketWithPricesModel> {
    let userMakroId = '';
    let userId = '';
    const authToken = extractAuthTokenFromContext(context);
    const appVersion = extractAppVersionFromContext(context);

    if (authToken && !deviceId) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims.shopifyId;
      userId = claims.userId;
    }

    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    if (!deviceId && !shopifyId) {
      throw new HttpException(
        'Neither devideId nor shopifyId of the associated user were provided or both of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (deviceId && shopifyId) {
      throw new HttpException(
        'Both deviceId and shopifyId were provided. Should provide 1 only, for either anonymous or logged-in basket',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.basketService.getBasketWithPrices({
      deviceId: deviceId || null,
      shopifyId: shopifyId || null,
      storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      appVersion,
      userMakroId,
      userId: userId || null,
      lang,
    });
  }

  @Mutation(() => BasketStoreExpansionModel, {
    description:
      'Updating/Creating a basket with a list of basketItems as an input array and voucherId and storeCode. ' +
      'Setting a line item`s quantity as 0 will result in deletion of that item. ' +
      'Either deviceId for anonymous user or accessToken for logged-in user must be provided but not both',
  })
  public async basketUpdateV3(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({ name: 'accessToken', nullable: true }) accessToken: string,
    @Args({ name: 'storeCode', nullable: true }) storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({
      name: 'basketItems',
      type: () => [BasketItemInputModel],
    })
    basketItems: [BasketItemInputModel],
    @Args({ name: 'voucherId', nullable: true })
    voucherId: string,
    @Args({ name: 'loyaltyPoints', nullable: true })
    loyaltyPoints: number,
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketStoreExpansionModel> {
    let shopifyId = '';
    let userMakroId = '';
    let userId = '';
    const appVersion = extractAppVersionFromContext(context);
    const authToken = extractAuthTokenFromContext(context);
    if (authToken) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims.shopifyId;
      userId = claims.userId;
    }

    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    if (!deviceId && !shopifyId) {
      throw new HttpException(
        'Neither devideId nor shopifyId of the associated user were provided or both of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (deviceId && shopifyId) {
      throw new HttpException(
        'Cant update both anonymous and signed-in basket, should provide either accessToken or deviceId only, not both',
        HttpStatus.BAD_REQUEST,
      );
    }
    // The old basket does not have loyalty point
    return await this.basketService.updateBasket({
      deviceId: deviceId || null,
      shopifyId: shopifyId || null,
      storeCode: storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      basketItemsInput: basketItems,
      voucherId,
      appVersion,
      userMakroId,
      userId: userId || null,
      loyaltyPoints: loyaltyPoints || 0,
      lang,
    });
  }

  @Mutation(() => BasketWithPricesModel, {
    description:
      'Updating/Creating a basket with a list of basketItems as an input array and voucherId and storeCode. ' +
      'Setting a line item`s quantity as 0 will result in deletion of that item. ' +
      'Either deviceId for anonymous user or accessToken for logged-in user must be provided but not both',
  })
  public async basketUpdateV4(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({ name: 'accessToken', nullable: true }) accessToken: string,
    @Args({ name: 'storeCode', nullable: true }) storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({
      name: 'basketItems',
      type: () => [BasketItemInputModel],
    })
    basketItems: [BasketItemInputModel],
    @Args({ name: 'voucherId', nullable: true }) voucherId: string,
    @Args({ name: 'loyaltyPoints', nullable: true }) loyaltyPoints: number,
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketWithPricesModel> {
    let userMakroId = '';
    let shopifyId = '';
    let userId = '';
    const appVersion = extractAppVersionFromContext(context);
    const authToken = extractAuthTokenFromContext(context);

    if (authToken) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims?.shopifyId || '';
      userId = claims?.userId || '';
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber || '';
    }
    if (!deviceId && !shopifyId && !userId) {
      throw new HttpException(
        'Neither devideId nor shopifyId nor userId of the associated user were provided or all of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (deviceId && (shopifyId || userId)) {
      throw new HttpException(
        'Cant update both anonymous and signed-in basket, should provide either accessToken or deviceId only, not both',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Don't allow client to use both points and voucher
    if (voucherId && loyaltyPoints) {
      throw new HttpException(
        'Can not apply voucher and loyalty points at the same time',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.basketService.updateBasketAndReturnBasketWithPrices({
      deviceId: deviceId || null,
      shopifyId: shopifyId || null, // will be removed once Shopify is removed
      storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      basketItemsInput: basketItems,
      voucherId,
      appVersion,
      userMakroId, // for loyalty and complex promotion
      userId: userId || null,
      loyaltyPoints: loyaltyPoints || 0,
      lang,
    });
  }

  @Mutation(() => UpdateBasketItemModel, {
    description:
      'Update an item in basket, removes if new quantity is 0' +
      'Either deviceId for anonymous user or accessToken for logged-in user must be provided but not both',
  })
  public async updateBasketItem(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({
      name: 'basketItem',
      type: () => BasketItemInputModel,
    })
    basketItem: BasketItemInputModel,
    @Args({ name: 'storeCode' })
    storeCode: string,
    @Context() context: ContextType,
  ): Promise<UpdateBasketItemModel> {
    let shopifyId = '';
    let userId = '';
    let userMakroId = '';
    const authToken = extractAuthTokenFromContext(context);

    if (authToken) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims?.shopifyId || '';
      userId = claims?.userId || '';
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber || '';
    }
    if (!deviceId && !shopifyId && !userId) {
      throw new HttpException(
        'Neither devideId nor shopifyId nor userId of the associated user were provided or all of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (deviceId && (shopifyId || userId)) {
      throw new HttpException(
        'Cant update both anonymous and signed-in basket, should provide either accessToken or deviceId only, not both',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.basketService.updateBasketItem({
      deviceId: deviceId || null,
      shopifyId: shopifyId || null, // will be removed once Shopify is removed
      basketItem,
      userId: userId || null,
      storeCode,
      userMakroId,
    });
  }

  @Mutation(() => String, {
    description:
      'Clear (delete) the basket associated with the user. ' +
      'Either deviceId for anonymous user or accessToken for logged-in user must be provided, but not both',
  })
  public async basketDeleteV3(
    @Args({ name: 'deviceId', nullable: true }) deviceId: string,
    @Args({ name: 'accessToken', nullable: true }) accessToken: string,
    @Context() context: ContextType,
  ) {
    let shopifyId = '';
    let userId = '';
    const authToken = extractAuthTokenFromContext(context);
    if (authToken) {
      const claims = await this.shopifyService.getClaimsFromAuthToken(
        authToken,
      );
      shopifyId = claims?.shopifyId;
      userId = claims?.userId;
    }
    if (!deviceId && !shopifyId) {
      throw new HttpException(
        'Neither devideId nor shopifyId of the associated user were provided or both of them were invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (deviceId && shopifyId) {
      throw new HttpException(
        'Cant delete both anonymous and signed-in basket, should provide either accessToken or deviceId only, not both',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.basketService.deleteBasket(
      deviceId || null,
      shopifyId || null,
      userId || null,
    );
  }

  @Mutation(() => String, {
    description: 'Clear (delete) the basket using basketId ',
  })
  public async basketDeleteV4(
    @Args({ name: 'basketId', nullable: false }) basketId: string,
  ) {
    return await this.basketService.deleteBasketByBasketId(basketId);
  }

  @Mutation(() => BasketStoreExpansionModel, {
    description:
      'Links basket between accessToken and deviceId when user signs-in, both must be provided to link',
  })
  public async linkBasketWithUserIdV3(
    @Args({ name: 'deviceId' }) deviceId: string,
    @Args({ name: 'accessToken' })
    accessToken: string,
    @Args({ name: 'storeCode' })
    storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketStoreExpansionModel> {
    const authToken = extractAuthTokenFromContext(context);
    const claims = await this.shopifyService.getClaimsFromAuthToken(authToken);
    const shopifyId = claims.shopifyId;
    const userId = claims.userId;

    if (!deviceId || !shopifyId) {
      throw new HttpException(
        'either deviceId or shopifyId is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }
    let userMakroId = '';
    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }
    const appVersion = extractAppVersionFromContext(context);
    return await this.basketService.linkBasketWithUserIdentifier({
      deviceId,
      shopifyId,
      storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      appVersion,
      userId: userId || null,
      userMakroId,
      lang,
    });
  }

  @Mutation(() => BasketWithPricesModel, {
    description:
      'Links basket between accessToken and deviceId when user signs-in, both must be provided to link',
  })
  public async linkBasketWithUserIdV4(
    @Args({ name: 'deviceId' }) deviceId: string,
    @Args({ name: 'accessToken' })
    accessToken: string,
    @Args({ name: 'storeCode' })
    storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context() context: ContextType,
  ): Promise<BasketWithPricesModel> {
    const authToken = extractAuthTokenFromContext(context);
    const claims = await this.shopifyService.getClaimsFromAuthToken(authToken);
    const shopifyId = claims.shopifyId;
    const userId = claims.userId;

    if (!deviceId || !shopifyId) {
      throw new HttpException(
        'either deviceId or shopifyId is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    const appVersion = extractAppVersionFromContext(context);
    let userMakroId = '';
    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    return await this.basketService.linkBasketWithUserIdentifierAndReturnBasketWithPrices(
      {
        deviceId,
        shopifyId,
        storeCode,
        storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
        appVersion,
        userId: userId || null,
        userMakroId,
        lang,
      },
    );
  }

  @Mutation(() => BasketStoreExpansionModel, {
    description: 'Add items from a favorite list to the basket',
  })
  public async addItemsFromFavoriteList(
    @Args({ name: 'accessToken' })
    accessToken: string,
    @Args({ name: 'favoriteListId' })
    favoriteListId: string,
    @Args({ name: 'storeCode' })
    storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context()
    context: ContextType,
  ): Promise<BasketStoreExpansionModel> {
    const appVersion = extractAppVersionFromContext(context);
    const authToken = extractAuthTokenFromContext(context);

    const claims = await this.shopifyService.getClaimsFromAuthToken(authToken);
    const shopifyId = claims?.shopifyId || '';
    const userId = claims?.userId || null;

    if (!shopifyId) {
      throw new UnauthorizedException();
    }

    let userMakroId = '';
    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    return await this.basketService.addItemsFromFavoriteList({
      associatedUserShopifyId: shopifyId,
      favoriteListId,
      storeCode,
      storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
      userId: userId,
      appVersion,
      userMakroId,
      lang,
    });
  }

  @Mutation(() => BasketWithPricesModel, {
    description: 'Add items from a favorite list to the basket',
  })
  public async addItemsFromFavoriteListV4(
    @Args({ name: 'accessToken' })
    accessToken: string,
    @Args({ name: 'favoriteListId' })
    favoriteListId: string,
    @Args({ name: 'storeCode' })
    storeCode: string,
    @Args({
      name: 'storeCodes',
      nullable: false,
      defaultValue: [],
      type: () => [String],
    })
    storeCodes: string[],
    @Args({ name: 'lang', nullable: true, defaultValue: Locale.DEFAULT })
    lang: Locale,
    @Context()
    context: ContextType,
  ): Promise<BasketWithPricesModel> {
    const appVersion = extractAppVersionFromContext(context);
    const authToken = extractAuthTokenFromContext(context);

    const claims = await this.shopifyService.getClaimsFromAuthToken(authToken);
    const shopifyId = claims?.shopifyId || '';
    const userId = claims?.userId || null;

    if (!shopifyId) {
      throw new UnauthorizedException();
    }

    let userMakroId = '';
    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    return await this.basketService.addItemsFromFavoriteListAndReturnBasketWithPrices(
      {
        associatedUserShopifyId: shopifyId,
        favoriteListId,
        storeCode,
        storeCodes: storeCodes.length > 0 ? storeCodes : [storeCode],
        userId,
        appVersion,
        lang,
        userMakroId,
      },
    );
  }

  @Query(() => BasketForCheckoutModel, {
    description: 'Retrieving the basket information for checkout-service',
  })
  public async basketForCheckoutService(
    @Context() context: ContextType,
  ): Promise<BasketForCheckoutModel> {
    const appVersion = extractAppVersionFromContext(context);
    const authToken = extractAuthTokenFromContext(context);

    const claims = await this.shopifyService.getClaimsFromAuthToken(authToken);
    const shopifyId = claims?.shopifyId || '';
    const userId = claims?.userId || null;

    let userMakroId = '';
    if (authToken) {
      const makroCard = await this.userService.getCustomerCards(authToken);
      userMakroId = makroCard?.cardNumber;
    }

    return await this.basketService.getBasketForCheckout(
      shopifyId,
      appVersion,
      userMakroId,
      userId,
    );
  }
}
