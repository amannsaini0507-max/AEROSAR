from setuptools import find_packages, setup

package_name = 'aerosar_backend_bridge'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Member 4 (Backend Lead)',
    maintainer_email='member4@aerosar.internal',
    description='AEROSAR Member 4 Backend & Data Integration Bridge',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'bridge_node = aerosar_backend_bridge.bridge_node:main',
        ],
    },
)
