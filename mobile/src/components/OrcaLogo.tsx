import Svg, { Circle, G, Path } from 'react-native-svg'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

type Props = {
  size?: number
  color?: string
}

export function OrcaLogo({ size = 24, color = colors.textPrimary }: Props) {
  useMobileColorScheme()
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <G opacity={0.72}>
        <Path d="M44 14v14c0 5-3 9-8 11" stroke={color} strokeWidth={4.5} strokeLinecap="round" />
        <Circle cx={44} cy={14} r={5.5} fill={color} />
      </G>
      <Path
        d="M20 14v14c0 8 6 12 12 14 6 2 12 5 12 10"
        stroke={color}
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      <Circle cx={20} cy={14} r={5.5} fill={color} />
      <Circle cx={44} cy={52} r={5.5} fill={color} />
    </Svg>
  )
}
