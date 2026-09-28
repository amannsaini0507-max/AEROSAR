from setuptools import find_packages, setup

package_name = 'aerosar_perception'

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
    maintainer='Member 2 (AI/CV Lead)',
    maintainer_email='member2@aerosar.internal',
    description='AEROSAR Member 2 Perception and Sensor Fusion Subsystem',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'perception_node = aerosar_perception.perception_node:main',
            'fusion_node = aerosar_perception.fusion_node:main',
        ],
    },
)
