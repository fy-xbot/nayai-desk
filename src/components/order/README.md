# 订单相关组件

## OrderStatusHeader

订单详情页顶部状态区：**红色渐变背景 + 左侧图标**，风格对齐用户端订单详情。

### 用法示例

```tsx
import { OrderStatusHeader } from "./OrderStatusHeader";

// 商家端订单详情：待接单
<OrderStatusHeader
  status="待接单"
  subtitle="2026-03-16 21:48:25 外卖配送"
/>

// 自定义图标
<OrderStatusHeader
  status="待接单"
  subtitle="2026-03-16 21:48:25 外卖配送"
  icon={<YourClockOrOrderIcon className="text-white w-6 h-6" />}
/>
```

### 样式说明

- 背景：`linear-gradient(135deg, #ff6b6b → #ee5a5a → #e74c3c)`
- 左侧：圆形容器（半透明白）+ 默认订单/文档图标，可传 `icon` 覆盖
- 右侧：状态主文案 + 副标题（时间、配送方式等）

若商家端订单详情在其它仓库，可把 `OrderStatusHeader.tsx` 拷过去并按需改类名或渐变色。
