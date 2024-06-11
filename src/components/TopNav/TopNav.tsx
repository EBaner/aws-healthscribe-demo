// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { Suspense, lazy, useEffect, useState } from 'react';

import TopNavigation, { TopNavigationProps } from '@cloudscape-design/components/top-navigation';
import { Density, Mode, applyDensity, applyMode } from '@cloudscape-design/global-styles';

import ModalLoader from '@/components/SuspenseLoader/ModalLoader';
import { useAppThemeContext } from '@/store/appTheme';
import { useAuthContext } from '@/store/auth';

import './TopNav.module.css';

const Auth = lazy(() => import('@/components/Auth'));

type TopNavClick = {
    detail: {
        id: string;
    };
};

interface CustomTopNavProps {
    logo: {
        src: string;
        alt: string;
    };
    logoStyle: {
        width: string;
        height: string;
    };
    utilities: (TopNavigationProps.MenuDropdownUtility | TopNavigationProps.ButtonUtility)[];
}

const CustomTopNav: React.FC<CustomTopNavProps> = ({ logo, logoStyle, utilities }) => {
    const identity: TopNavigationProps['identity'] = {
        logo: { src: logo.src, alt: logo.alt },
        href: '/',
    };

    return <TopNavigation identity={identity} utilities={utilities} />;
};

export default function TopNav() {
    const { isUserAuthenticated, user, signOut } = useAuthContext();
    const { appTheme, setAppThemeColor, setAppThemeDensity } = useAppThemeContext();

    const [authVisible, setAuthVisible] = useState(false); // authentication modal visibility

    // Set app theme
    useEffect(() => {
        if (appTheme.color === 'appTheme.light') {
            applyMode(Mode.Light);
        } else if (appTheme.color === 'appTheme.dark') {
            applyMode(Mode.Dark);
        }

        if (appTheme.density === 'density.comfortable') {
            applyDensity(Density.Comfortable);
        } else if (appTheme.density === 'density.compact') {
            applyDensity(Density.Compact);
        }
    }, [appTheme]);

    // When user authenticates, close authentication modal window
    useEffect(() => {
        if (isUserAuthenticated) {
            setAuthVisible(false);
        }
        // no else because we want the auth window to only pop up by clicking sign in, not automatically
    }, [isUserAuthenticated]);

    // Change visualization
    function handleUtilVisualClick(e: TopNavClick) {
        switch (e.detail.id) {
            case 'appTheme.light':
                setAppThemeColor('appTheme.light');
                break;
            case 'appTheme.dark':
                setAppThemeColor('appTheme.dark');
                break;
            case 'density.comfortable':
                setAppThemeDensity('density.comfortable');
                break;
            case 'density.compact':
                setAppThemeDensity('density.compact');
                break;
            default:
                break;
        }
    }

    // App theme dropdown
    const utilVisual: TopNavigationProps.MenuDropdownUtility = {
        type: 'menu-dropdown',
        iconName: 'settings',
        ariaLabel: 'Settings',
        title: 'Settings',
        items: [
            {
                id: 'appTheme',
                text: 'Theme',
                items: [
                    {
                        id: 'appTheme.light',
                        text: 'Light',
                        disabled: appTheme.color === 'appTheme.light',
                        disabledReason: 'Currently selected',
                    },
                    {
                        id: 'appTheme.dark',
                        text: 'Dark',
                        disabled: appTheme.color === 'appTheme.dark',
                        disabledReason: 'Currently selected',
                    },
                ],
            },
            {
                id: 'density',
                text: 'Density',
                items: [
                    {
                        id: 'density.comfortable',
                        text: 'Comfortable',
                        disabled: appTheme.density === 'density.comfortable',
                        disabledReason: 'Currently selected',
                    },
                    {
                        id: 'density.compact',
                        text: 'Compact',
                        disabled: appTheme.density === 'density.compact',
                        disabledReason: 'Currently selected',
                    },
                ],
            },
        ],
        onItemClick: (e) => handleUtilVisualClick(e),
    };

    // User auth dropdown (if auth) else sign-in
    const utilUser: TopNavigationProps.ButtonUtility | TopNavigationProps.MenuDropdownUtility = isUserAuthenticated
        ? {
              type: 'menu-dropdown',
              text: user?.signInDetails?.loginId || user?.username,
              description: user?.signInDetails?.loginId,
              iconName: 'user-profile',
              items: [{ id: 'signout', text: 'Sign out' }],
              onItemClick: () => signOut(),
          }
        : {
              type: 'button',
              text: 'Sign In',
              onClick: () => setAuthVisible(true),
          };

    const navUtils: (TopNavigationProps.MenuDropdownUtility | TopNavigationProps.ButtonUtility)[] = [
        utilVisual,
        utilUser,
    ];

    return (
        <>
            {authVisible && (
                <Suspense fallback={<ModalLoader />}>
                    <Auth setVisible={setAuthVisible} />
                </Suspense>
            )}
            <CustomTopNav
                logo={{
                    src: '/AURIBUS.png',
                    alt: 'Auribus Technologies',
                }}
                logoStyle={{ width: '800px', height: '600px' }} // Define logoStyle
                utilities={navUtils}
            />
        </>
    );
}
