'use client';

import { NABUX_CHANNELS } from '@gitroom/nestjs-libraries/integrations/social/nabux/nabux.contract';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';

export const nabuxLaunchProviders = NABUX_CHANNELS.map((channel) => ({
  identifier: channel.identifier,
  component: withProvider({
    postComment: PostComment.POST,
    minimumCharacters: [],
    SettingsComponent: null,
    CustomPreviewComponent: undefined,
    dto: undefined,
    maximumCharacters: channel.maxLength,
  }),
}));
