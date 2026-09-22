export function setRefValue<T>(ref: { current: T }, value: T) {
  ref.current = value;
}
