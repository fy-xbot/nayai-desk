interface ProviderDotProps {
  color: string;
  size?: number;
}

export function ProviderDot({ color, size = 8 }: ProviderDotProps) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ backgroundColor: color, width: size, height: size }}
    />
  );
}
