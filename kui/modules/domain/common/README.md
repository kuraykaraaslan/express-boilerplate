# modules/domain/common — Cross-Domain Partials

Reusable domain partials that are not tied to a single vertical (auth, cart, user, payment, money, i18n, notifications, ...). Composed by every theme.

## Files

```
NotFoundPage.ejs

address/         AddressCard, AddressForm, AddressSelector
auth/            ChangePasswordForm, ForgotPasswordForm, LoginForm,
                 OAuthButtons, RegisterForm, SessionExpiredBanner
cart/            CartBadge, CartItem, CartPreview, CartSummary
charts/          Charts
chat/            ChatBox
discount/        CouponInput, DiscountBadge
i18n/            DirectionProvider, LanguageSwitcher
location/        CountrySelector, GeoPointDisplay, LocationPicker
money/           CurrencySelector, OrderTotalsCard, PriceDisplay
notification/    NotificationFilterTabs, NotificationListItem, NotificationMenu
payment/         CheckoutSuccessState, CreditCardForm, CreditCardVisual,
                 PaymentMethodSelector, PaymentStatusBadge, PaymentSummaryCard,
                 SavedCardSelector
seo/             SeoForm, SeoPreview
status/          ProcessingStatusIndicator, PublishStatusBadge, VisibilityBadge
subscription/    SubscriptionPlanCard
user/            UserAvatar, UserMenu, UserPreferencesForm,
                 UserProfileCard, UserProfileForm, UserRoleBadge, UserStatusBadge
```

## Parity

Shared with NextJS: yes — counterpart is `/home/kuray/01_NextJS_Components/modules/domains/common/`. Keep names, props, and rendered DOM in sync.

## Conventions

1. **Header destructure** — `<% const { user, address = null, ... } = locals; %>`.
2. **Icons** — Font Awesome: `<i class="fa-solid fa-credit-card" aria-hidden="true"></i>`.
3. **React state → vanilla IIFE** — wrap interactive logic in `<script>(function(){ ... })();</script>` keyed on a unique element id.
4. **Shared Tailwind tokens** — `bg-surface-raised`, `text-text-primary`, `border-border`; no raw color values.
5. **Compose** primitives from `modules/ui/`; don't re-implement `Button`, `Input`, `Modal`.

## See also

- Repo conventions: [`/home/kuray/02_EJS_Components/AGENTS.md`](../../../AGENTS.md)
- Parity contract & pixel-perfect rule: `../../../../00_Config_and_AI_Rules`
